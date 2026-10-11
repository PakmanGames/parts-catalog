import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { beforeEach, describe, expect, test } from "vitest";
import type { CleanRow, NormalizedRow, RejectReason } from "@/contracts/import-rows";
import type { ImportSummary } from "@/contracts/imports";
import { parts } from "@/db/schema";
import { createTestDb } from "../../../tests/db";
import { ImportAlreadyRunningError, importRows } from "./load";

const db = await createTestDb();

/** Empties the catalog, since every import marks parts missing from it unavailable. */
async function reset() {
  await db.execute(sql`TRUNCATE parts, quote_lines, quotes RESTART IDENTITY`);
}

beforeEach(reset);

type Values = Partial<Omit<CleanRow, "lineNumber" | "partNumber" | "supplier" | "lastUpdated">>;

/** An accepted row; values default to known ones. */
function accepted(
  lineNumber: number,
  partNumber: string,
  supplier: string,
  lastUpdated: string,
  values: Values = {},
): NormalizedRow {
  return {
    outcome: "accepted",
    lineNumber,
    partNumber,
    supplier,
    quantity: 10,
    price: "1.00",
    leadTimeDays: 7,
    lastUpdated: new Date(lastUpdated),
    ...values,
  };
}

/** A rejected row; with `partNumber`, it keeps its part and timestamp (A17). */
function rejected(
  lineNumber: number,
  reason: RejectReason,
  identity?: { partNumber: string; supplier: string; lastUpdated: string },
): NormalizedRow {
  return {
    outcome: "rejected",
    lineNumber,
    reason,
    identity: identity ? { ...identity, lastUpdated: new Date(identity.lastUpdated) } : null,
  };
}

async function load(rows: NormalizedRow[]): Promise<Omit<ImportSummary, "durationMs">> {
  async function* stream() {
    yield* rows;
  }
  const { durationMs, ...summary } = await importRows(db, stream());
  expect(durationMs).toBeGreaterThanOrEqual(0);
  return summary;
}

async function catalog() {
  const rows = await db.select().from(parts).orderBy(parts.supplierKey, parts.partNumberKey);
  return rows.map(({ id: _id, ...part }) => part);
}

const none = {
  rejected: {},
  newestRejected: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  markedUnavailable: 0,
  madeAvailable: 0,
};

describe("importRows", () => {
  test("inserts new parts with their keys, and writes nothing when re-run (D5)", async () => {
    const rows = [
      accepted(2, "AN960C10L", "Allied Fastener Supply", "2026-09-01"),
      accepted(3, "MS21045L176", "Allied Fastener Supply", "2026-09-02", {
        quantity: null,
        price: null,
        leadTimeDays: null,
      }),
    ];
    expect(await load(rows)).toEqual({ ...none, rowsRead: 2, duplicatesCollapsed: 0, inserted: 2 });
    const first = await catalog();
    expect(first).toEqual([
      expect.objectContaining({
        supplierKey: "ALLIEDFASTENERSUPPLY",
        partNumberKey: "AN960C10L",
        quantity: 10,
        price: "1.00",
        unavailableSince: null,
      }),
      expect.objectContaining({ partNumberKey: "MS21045L176", quantity: null, price: null }),
    ]);

    expect(await load(rows)).toEqual({
      ...none,
      rowsRead: 2,
      duplicatesCollapsed: 0,
      unchanged: 2,
    });
    expect(await catalog()).toEqual(first);
  });

  test("lets the newest row win wherever it is in the file, and the later line win a tie (C3, A4)", async () => {
    const summary = await load([
      accepted(2, "P-1", "Acme", "2026-09-10", { quantity: 1 }),
      accepted(3, "p1", "Acme", "2026-09-01", { quantity: 2 }),
      accepted(4, "Q 1", "Acme", "2026-09-01", { quantity: 3 }),
      accepted(5, "Q-1", "Acme", "2026-09-01", { quantity: 4 }),
    ]);
    expect(summary).toEqual({ ...none, rowsRead: 4, duplicatesCollapsed: 2, inserted: 2 });
    expect(await catalog()).toEqual([
      expect.objectContaining({ partNumber: "P-1", quantity: 1 }),
      expect.objectContaining({ partNumber: "Q-1", quantity: 4 }),
    ]);
  });

  test("lets a newest row with unknown values beat an older row with good ones (A19)", async () => {
    await load([
      accepted(2, "P1", "Acme", "2026-09-01", { quantity: 5, price: "9.99" }),
      accepted(3, "P1", "Acme", "2026-09-02", { quantity: null, price: null }),
    ]);
    expect(await catalog()).toEqual([expect.objectContaining({ quantity: null, price: null })]);
  });

  test("accepts a future-dated row as the newest (A18)", async () => {
    await load([
      accepted(2, "P1", "Acme", "2027-01-20T04:07:54Z", { quantity: 1 }),
      accepted(3, "P1", "Acme", "2026-09-27", { quantity: 2 }),
    ]);
    expect(await catalog()).toEqual([
      expect.objectContaining({ quantity: 1, lastUpdated: new Date("2027-01-20T04:07:54Z") }),
    ]);
  });

  test("counts a change to or from an unknown value as an update", async () => {
    await load([accepted(2, "P1", "Acme", "2026-09-01", { quantity: 5 })]);
    const toUnknown = await load([accepted(2, "P1", "Acme", "2026-09-01", { quantity: null })]);
    expect(toUnknown).toMatchObject({ updated: 1, unchanged: 0 });
    const fromUnknown = await load([accepted(2, "P1", "Acme", "2026-09-01", { quantity: 5 })]);
    expect(fromUnknown).toMatchObject({ updated: 1, unchanged: 0 });
  });

  describe("a rejected newest row (A17)", () => {
    test("keeps a new part out, and an older valid copy never stands in", async () => {
      const summary = await load([
        accepted(2, "P1", "Acme", "2026-04-01"),
        rejected(3, "quantity is negative", {
          partNumber: "P1",
          supplier: "Acme",
          lastUpdated: "2026-09-15",
        }),
        rejected(4, "row is empty"),
      ]);
      expect(summary).toEqual({
        ...none,
        rowsRead: 3,
        duplicatesCollapsed: 1,
        rejected: { "quantity is negative": 1, "row is empty": 1 },
        newestRejected: 1,
      });
      expect(await catalog()).toEqual([]);
    });

    test("marks an existing part unavailable, and an older rejected row changes nothing", async () => {
      await load([
        accepted(2, "P1", "Acme", "2026-04-01"),
        accepted(3, "P2", "Acme", "2026-04-01"),
      ]);
      const summary = await load([
        accepted(2, "P1", "Acme", "2026-04-01"),
        rejected(3, "price is negative", {
          partNumber: "P1",
          supplier: "Acme",
          lastUpdated: "2026-01-01",
        }),
        rejected(4, "price is negative", {
          partNumber: "P2",
          supplier: "Acme",
          lastUpdated: "2026-05-01",
        }),
      ]);
      expect(summary).toMatchObject({ unchanged: 1, markedUnavailable: 1, newestRejected: 1 });
      const [p1, p2] = await catalog();
      expect(p1?.unavailableSince).toBeNull();
      expect(p2?.unavailableSince).toBeInstanceOf(Date);
    });
  });

  test("marks missing parts unavailable once, keeps the time on re-runs, and brings them back (C11, A15)", async () => {
    await load([accepted(2, "P1", "Acme", "2026-09-01"), accepted(3, "P2", "Acme", "2026-09-01")]);

    expect(await load([accepted(2, "P1", "Acme", "2026-09-01")])).toMatchObject({
      unchanged: 1,
      markedUnavailable: 1,
    });
    const [, missing] = await catalog();
    expect(missing?.unavailableSince).toBeInstanceOf(Date);

    expect(await load([accepted(2, "P1", "Acme", "2026-09-01")])).toMatchObject({
      unchanged: 1,
      markedUnavailable: 0,
    });
    expect((await catalog())[1]?.unavailableSince).toEqual(missing?.unavailableSince);

    const back = await load([
      accepted(2, "P1", "Acme", "2026-09-01"),
      accepted(3, "P2", "Acme", "2026-09-01"),
    ]);
    expect(back).toMatchObject({ unchanged: 1, updated: 0, madeAvailable: 1 });
    expect((await catalog())[1]?.unavailableSince).toBeNull();
  });

  describe("supplier spelling (A13)", () => {
    test("uses the most common spelling, even when the newest row is spelled differently", async () => {
      await load([
        accepted(2, "P1", "Allied Fastener Supply", "2026-09-01"),
        accepted(3, "P2", "ALLIED FASTENER SUPPLY", "2026-09-20"),
        accepted(4, "P3", "Allied Fastener Supply", "2026-08-15"),
      ]);
      const suppliers = new Set((await catalog()).map((part) => part.supplier));
      expect([...suppliers]).toEqual(["Allied Fastener Supply"]);
    });

    test("breaks a tie by the spelling with the newest row, in either file order", async () => {
      const a = accepted(2, "P1", "Cascade Aerospace Parts.", "2026-09-27");
      const b = accepted(3, "P2", "Cascade Aerospace Parts", "2027-01-20");
      for (const rows of [[a, b], [b, a].map((row, i) => ({ ...row, lineNumber: i + 2 }))]) {
        await reset();
        await load(rows);
        const suppliers = new Set((await catalog()).map((part) => part.supplier));
        expect([...suppliers]).toEqual(["Cascade Aerospace Parts"]);
      }
    });

    test("ignores rejected rows when counting spellings", async () => {
      await load([
        accepted(2, "P1", "Apex Machined Parts", "2026-09-01"),
        rejected(3, "price is negative", {
          partNumber: "P2",
          supplier: "APEX",
          lastUpdated: "2026-01-01",
        }),
        rejected(4, "price is negative", {
          partNumber: "P3",
          supplier: "APEX",
          lastUpdated: "2026-01-01",
        }),
      ]);
      expect((await catalog()).map((part) => part.supplier)).toEqual(["Apex Machined Parts"]);
    });

    test("rewrites a supplier's parts when its spelling changes, as an update", async () => {
      await load([accepted(2, "P1", "Anchor Fluid Power", "2026-09-01")]);
      const summary = await load([accepted(2, "P1", "ANCHOR FLUID POWER", "2026-09-01")]);
      expect(summary).toMatchObject({ updated: 1 });
      expect((await catalog())[0]).toMatchObject({
        supplier: "ANCHOR FLUID POWER",
        supplierKey: "ANCHORFLUIDPOWER",
      });
    });
  });

  test("copies text that COPY would otherwise misread", async () => {
    await load([accepted(2, "A\\B\tC", "Weird\\Supplier\nName", "2026-09-01")]);
    expect((await catalog())[0]).toMatchObject({
      partNumber: "A\\B\tC",
      supplier: "Weird\\Supplier\nName",
    });
  });

  test("leaves the catalog untouched when the rows fail part-way, and a re-run then succeeds (R1.4)", async () => {
    const rows = [accepted(2, "P1", "Acme", "2026-09-01"), accepted(3, "P2", "Acme", "2026-09-01")];
    await load([accepted(2, "P0", "Acme", "2026-09-01")]);
    const before = await catalog();

    async function* failing() {
      yield* rows;
      throw new Error("the upload stopped");
    }
    await expect(importRows(db, failing())).rejects.toThrow("the upload stopped");
    expect(await catalog()).toEqual(before);

    expect(await load(rows)).toMatchObject({ inserted: 2, markedUnavailable: 1 });
  });

  test("fails fast while another import holds the lock", async () => {
    // A second connection stands in for another import, such as the CLI during an upload.
    const { connectionString } = db.$client.options as { connectionString: string };
    const other = new Pool({ connectionString, max: 1 });
    try {
      const holder = await other.connect();
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtext('parts-catalog import'))");

      await expect(load([accepted(2, "P1", "Acme", "2026-09-01")])).rejects.toBeInstanceOf(
        ImportAlreadyRunningError,
      );
      expect(await catalog()).toEqual([]);

      await holder.query("ROLLBACK");
      holder.release();
    } finally {
      await other.end();
    }
    expect(await load([accepted(2, "P1", "Acme", "2026-09-01")])).toMatchObject({ inserted: 1 });
  });
});
