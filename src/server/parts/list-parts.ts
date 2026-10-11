/**
 * The parts query behind `GET /api/parts` (PRD 7.3): search, supplier filter, sort, and keyset
 * pagination, with unknown values last in both directions (R2.2).
 */
import { and, asc, desc, gt, isNotNull, isNull, lt, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { Id, Money } from "@/contracts/common";
import { type PartsQuery, type PartsResponse, SortDirection } from "@/contracts/parts";
import type { Db } from "@/db";
import { parts } from "@/db/schema";

/** A cursor that doesn't decode, or that came from a different sort or direction. */
export class InvalidCursorError extends Error {}

/** Sorting by part number sorts by its key, so variants of one number sort together (PRD 7.3). */
const SORT_COLUMNS = {
  part_number: parts.partNumberKey,
  quantity: parts.quantity,
  price: parts.price,
  lead_time: parts.leadTimeDays,
} as const;

/**
 * Where the next page starts: the sort value and id of the last row on the previous page.
 * `value` is `null` once paging has reached the parts whose value is unknown, which all come after
 * the known ones. Each sort's value has its own type, so a forged value never reaches SQL.
 */
const Cursor = z.discriminatedUnion("sort", [
  z.object({ sort: z.literal("part_number"), dir: SortDirection, value: z.string(), id: Id }),
  z.object({
    sort: z.literal("quantity"),
    dir: SortDirection,
    value: z.int().nonnegative().nullable(),
    id: Id,
  }),
  z.object({ sort: z.literal("price"), dir: SortDirection, value: Money.nullable(), id: Id }),
  z.object({
    sort: z.literal("lead_time"),
    dir: SortDirection,
    value: z.int().nonnegative().nullable(),
    id: Id,
  }),
]);
type Cursor = z.infer<typeof Cursor>;

/**
 * `normalize_key` keeps only `A-Z` and `0-9` after upper-casing, so a term without an ASCII letter or
 * digit normalizes to nothing. Checking here leaves the search out of the SQL, instead of sending a
 * match-everything `LIKE '%%'` the planner can't use an index for (PRD 7.3).
 */
const SEARCHABLE = /[a-z0-9]/i;

/**
 * Returns one page of parts, and the cursor for the next page, or `null` on the last page.
 *
 * Paging is keyset on `(sort value, id)` (D6). Postgres sorts NULLs last ascending but first in a
 * backward index scan, so instead of extra `DESC NULLS LAST` indexes a page walks two phases: the
 * known values on the `(column, id)` index in either direction, then the unknown values by id.
 * The cursor records the phase, and the page that crosses the boundary runs both queries.
 *
 * Throws `InvalidCursorError` for a cursor this sort and direction didn't produce.
 */
export async function listParts(db: Db, query: PartsQuery): Promise<PartsResponse> {
  const { sort, dir, limit } = query;
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor, sort, dir);
  const column = SORT_COLUMNS[sort];
  const ascending = dir === "asc";
  const order = ascending ? asc : desc;

  // Built from fixed fragments with bound parameters, so the planner sees only the real filters, and
  // user input never becomes SQL. Normalizing in SQL keeps normalize_key the one definition (D13).
  const filters: SQL[] = [];
  if (query.q !== undefined && SEARCHABLE.test(query.q)) {
    // The normalized term holds only letters and digits, so it can't contain LIKE wildcards.
    filters.push(sql`${parts.partNumberKey} like '%' || normalize_key(${query.q}) || '%'`);
  }
  if (query.supplier.length > 0) {
    // Postgres turns `IN` with one item into `=`, which keeps the (supplier_key, column, id) index
    // order, and with several into `= ANY(...)`.
    const keys = query.supplier.map((name) => sql`normalize_key(${name})`);
    filters.push(sql`${parts.supplierKey} in (${sql.join(keys, sql`, `)})`);
  }

  const page = (where: (SQL | undefined)[], orderBy: SQL[], count: number) =>
    db
      .select({
        id: parts.id,
        partNumber: parts.partNumber,
        supplier: parts.supplier,
        quantity: parts.quantity,
        price: parts.price,
        leadTimeDays: parts.leadTimeDays,
        lastUpdated: parts.lastUpdated,
        unavailableSince: parts.unavailableSince,
        sortValue: column,
      })
      .from(parts)
      .where(and(...filters, ...where))
      .orderBy(...orderBy)
      .limit(count);

  // One extra row says whether there is a next page, without counting (D7).
  const rows = [];
  if (cursor?.value !== null) {
    // A row comparison, so the scan seeks straight to the cursor in the (column, id) index.
    const fromCursor =
      cursor &&
      (ascending
        ? sql`(${column}, ${parts.id}) > (${cursor.value}, ${cursor.id})`
        : sql`(${column}, ${parts.id}) < (${cursor.value}, ${cursor.id})`);
    const known = [isNotNull(column), fromCursor];
    rows.push(...(await page(known, [order(column), order(parts.id)], limit + 1)));
  }
  // Part numbers are never unknown, so that sort has no second phase.
  if (rows.length <= limit && sort !== "part_number") {
    const fromCursor =
      cursor?.value === null ? (ascending ? gt : lt)(parts.id, cursor.id) : undefined;
    const unknown = [isNull(column), fromCursor];
    rows.push(...(await page(unknown, [order(parts.id)], limit + 1 - rows.length)));
  }

  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(({ sortValue: _, lastUpdated, unavailableSince, ...part }) => ({
      ...part,
      lastUpdated: lastUpdated.toISOString(),
      unavailableSince: unavailableSince?.toISOString() ?? null,
    })),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ sort, dir, value: last.sortValue, id: last.id } as Cursor)
        : null,
  };
}

/** Opaque to the client: base64url JSON, so it fits in a query string without escaping. */
function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(text: string, sort: PartsQuery["sort"], dir: PartsQuery["dir"]): Cursor {
  let cursor: Cursor;
  try {
    cursor = Cursor.parse(JSON.parse(Buffer.from(text, "base64url").toString("utf8")));
  } catch {
    throw new InvalidCursorError("The cursor is not one this server issued");
  }
  // A position in one ordering means nothing in another.
  if (cursor.sort !== sort || cursor.dir !== dir) {
    throw new InvalidCursorError("The cursor is for a different sort or direction");
  }
  return cursor;
}
