/**
 * Loads one export into the catalog (PRD 7.2, steps 2 and 3).
 *
 * Everything happens in one transaction on one connection (D3): the rows are copied into a temporary
 * staging table, each part's newest row and each supplier's display spelling are found in SQL, and one
 * `MERGE` brings `parts` in line with the file. A failure anywhere rolls all of it back, so re-running
 * after a crash gives the same result as an uninterrupted run (R1.4), and readers only ever see the
 * catalog before or after an import, never halfway (R1.7).
 */
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { PoolClient } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import type { NormalizedRow, RejectReason } from "@/contracts/import-rows";
import type { ImportSummary } from "@/contracts/imports";
import type { Db } from "@/db";

/** Thrown when another import holds the import lock, whether in this process, another, or the CLI. */
export class ImportAlreadyRunningError extends Error {
  constructor() {
    super("Another import is already running.");
    this.name = "ImportAlreadyRunningError";
  }
}

/**
 * Imports `rows`, one `NormalizedRow` per data line in file order, and returns the R1.6 summary.
 *
 * A second import fails fast with `ImportAlreadyRunningError` instead of waiting for the first: an
 * import takes minutes, and the upload route has already told the buyer it started.
 */
export async function importRows(
  db: Db,
  rows: AsyncIterable<NormalizedRow>,
): Promise<ImportSummary> {
  const started = performance.now();
  const client = await db.$client.connect();
  let failure: unknown;
  let summary: Omit<ImportSummary, "durationMs">;
  try {
    await client.query("BEGIN");
    // Without this, a query whose client has died runs to completion before Postgres notices, so a
    // crashed import would hold the lock below, blocking a retry, for as long as its MERGE takes.
    await client.query("SET LOCAL client_connection_check_interval = '1s'");
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext('parts-catalog import')) AS locked",
    );
    if (!lock.rows[0]?.locked) throw new ImportAlreadyRunningError();
    await client.query(CREATE_STAGING);
    const copied = await copyRows(client, rows);
    const merged = await client.query<MergeCounts>(MERGE);
    await client.query("COMMIT");
    summary = summarize(copied, merged.rows[0]);
  } catch (error) {
    failure = error;
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    // A connection that failed mid-COPY may be unusable, so it is closed rather than reused.
    client.release(failure instanceof Error ? failure : undefined);
  }
  // Outside the transaction, so the planner's statistics describe the committed catalog.
  await db.$client.query("ANALYZE parts");
  return { ...summary, durationMs: Math.round(performance.now() - started) };
}

/**
 * Every accepted row, and the part and timestamp of every rejected row that has them (A17), with its
 * line number for tie-breaks (A4). The keys are generated once here instead of in every query below.
 */
const CREATE_STAGING = `
  CREATE TEMPORARY TABLE staging (
    line_number     integer NOT NULL,
    rejected        boolean NOT NULL,
    supplier        text NOT NULL,
    part_number     text NOT NULL,
    quantity        integer,
    price           numeric(12, 2),
    lead_time_days  integer,
    last_updated    timestamptz NOT NULL,
    supplier_key    text GENERATED ALWAYS AS (normalize_key(supplier)) STORED,
    part_number_key text GENERATED ALWAYS AS (normalize_key(part_number)) STORED
  ) ON COMMIT DROP`;

const COPY_STAGING = `COPY staging (line_number, rejected, supplier, part_number, quantity, price,
  lead_time_days, last_updated) FROM STDIN`;

type Copied = {
  rowsRead: number;
  accepted: number;
  rejected: Partial<Record<RejectReason, number>>;
};

/** Streams the rows into staging with `COPY`, counting them on the way. */
async function copyRows(client: PoolClient, rows: AsyncIterable<NormalizedRow>): Promise<Copied> {
  const copied: Copied = { rowsRead: 0, accepted: 0, rejected: {} };
  async function* lines() {
    // Batching keeps COPY to a few thousand writes instead of one per row.
    let batch = "";
    for await (const row of rows) {
      copied.rowsRead += 1;
      if (row.outcome === "accepted") {
        copied.accepted += 1;
        batch += copyLine(
          row.lineNumber,
          false,
          row.supplier,
          row.partNumber,
          row.quantity,
          row.price,
          row.leadTimeDays,
          row.lastUpdated,
        );
      } else {
        copied.rejected[row.reason] = (copied.rejected[row.reason] ?? 0) + 1;
        const { identity } = row;
        if (identity) {
          batch += copyLine(
            row.lineNumber,
            true,
            identity.supplier,
            identity.partNumber,
            null,
            null,
            null,
            identity.lastUpdated,
          );
        }
      }
      if (batch.length >= 65_536) {
        yield batch;
        batch = "";
      }
    }
    if (batch) yield batch;
  }
  await pipeline(Readable.from(lines()), client.query(copyFrom(COPY_STAGING)));
  return copied;
}

/** One line of COPY's text format: tab-separated, with `\N` for NULL. */
function copyLine(...values: (string | number | boolean | Date | null)[]): string {
  return `${values.map(copyValue).join("\t")}\n`;
}

const COPY_ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  "\t": "\\t",
  "\n": "\\n",
  "\r": "\\r",
};

function copyValue(value: string | number | boolean | Date | null): string {
  if (value === null) return "\\N";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.replace(/[\\\t\n\r]/g, (c) => COPY_ESCAPES[c] ?? c);
  return String(value);
}

type MergeCounts = {
  parts_in_file: number;
  newest_rejected: number;
  inserted: number;
  updated: number;
  marked_unavailable: number;
  made_available: number;
};

/**
 * Steps 2.4 to 2.6 of PRD 7.2 as one statement, returning the counts the summary needs.
 *
 * - `newest`: each part's newest row, by timestamp and then line (C3, A4), counting rejected rows,
 *   so a rejected newest row makes its part absent from `source` (A17).
 * - `spelling`: each supplier's most common spelling among accepted rows. Ties go to the spelling
 *   whose newest row is newest (A13). `mode()` isn't used, because it breaks ties arbitrarily.
 * - `merged`: the `MERGE`. Unchanged parts match no clause, so nothing is written for them (D5), and
 *   `IS DISTINCT FROM` treats NULL as a value, so a change to or from unknown is an update (A19).
 *   `old` and `new` in `RETURNING` (Postgres 18) tell updates from parts marked unavailable or made
 *   available again.
 */
const MERGE = `
  WITH newest AS (
    SELECT DISTINCT ON (supplier_key, part_number_key) *
    FROM staging
    ORDER BY supplier_key, part_number_key, last_updated DESC, line_number DESC
  ),
  spelling AS (
    SELECT DISTINCT ON (supplier_key) supplier_key, supplier
    FROM (
      SELECT supplier_key, supplier, last_updated, line_number,
             count(*) OVER (PARTITION BY supplier_key, supplier) AS uses
      FROM staging
      WHERE NOT rejected
    ) uses
    ORDER BY supplier_key, uses DESC, last_updated DESC, line_number DESC
  ),
  source AS (
    SELECT newest.supplier_key, newest.part_number_key, spelling.supplier, newest.part_number,
           newest.quantity, newest.price, newest.lead_time_days, newest.last_updated
    FROM newest
    JOIN spelling USING (supplier_key)
    WHERE NOT newest.rejected
  ),
  merged AS (
    MERGE INTO parts AS p
    USING source AS s
    ON p.supplier_key = s.supplier_key AND p.part_number_key = s.part_number_key
    WHEN MATCHED AND (
      p.unavailable_since IS NOT NULL
      OR (p.supplier, p.part_number, p.quantity, p.price, p.lead_time_days, p.last_updated)
         IS DISTINCT FROM (s.supplier, s.part_number, s.quantity, s.price, s.lead_time_days, s.last_updated)
    ) THEN
      UPDATE SET supplier = s.supplier, part_number = s.part_number, quantity = s.quantity,
                 price = s.price, lead_time_days = s.lead_time_days, last_updated = s.last_updated,
                 unavailable_since = NULL
    WHEN NOT MATCHED BY TARGET THEN
      INSERT (supplier, part_number, quantity, price, lead_time_days, last_updated)
      VALUES (s.supplier, s.part_number, s.quantity, s.price, s.lead_time_days, s.last_updated)
    WHEN NOT MATCHED BY SOURCE AND p.unavailable_since IS NULL THEN
      UPDATE SET unavailable_since = now()
    RETURNING merge_action() AS action,
              old.unavailable_since IS NOT NULL AS was_unavailable,
              new.unavailable_since IS NOT NULL AS is_unavailable
  )
  SELECT
    (SELECT count(*) FROM source)::int AS parts_in_file,
    (SELECT count(*) FROM newest WHERE rejected)::int AS newest_rejected,
    count(*) FILTER (WHERE action = 'INSERT')::int AS inserted,
    count(*) FILTER (WHERE action = 'UPDATE' AND NOT was_unavailable AND NOT is_unavailable)::int AS updated,
    count(*) FILTER (WHERE action = 'UPDATE' AND NOT was_unavailable AND is_unavailable)::int AS marked_unavailable,
    count(*) FILTER (WHERE action = 'UPDATE' AND was_unavailable)::int AS made_available
  FROM merged`;

/** Turns the copy and merge counts into the summary, whose sums the contract spells out. */
function summarize(
  copied: Copied,
  merged: MergeCounts | undefined,
): Omit<ImportSummary, "durationMs"> {
  if (!merged) throw new Error("The merge returned no counts.");
  return {
    rowsRead: copied.rowsRead,
    duplicatesCollapsed: copied.accepted - merged.parts_in_file,
    rejected: copied.rejected,
    newestRejected: merged.newest_rejected,
    inserted: merged.inserted,
    updated: merged.updated,
    unchanged: merged.parts_in_file - merged.inserted - merged.updated - merged.made_available,
    markedUnavailable: merged.marked_unavailable,
    madeAvailable: merged.made_available,
  };
}
