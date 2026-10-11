/** Contracts for browsing the catalog (PRD R2, 7.3, 7.4). */
import { z } from "zod";
import { Id, Money, Timestamp } from "./common";

export const PartSort = z.enum(["part_number", "quantity", "price", "lead_time"]);
export type PartSort = z.infer<typeof PartSort>;

export const SortDirection = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof SortDirection>;

/**
 * `GET /api/parts` query parameters, after `readPartsQuery` has collected them from the URL.
 * The search term is left as typed: the server normalizes it with `normalize_key`, and treats a term
 * that normalizes to nothing as no search (PRD 7.3).
 */
export const PartsQuery = z.object({
  q: z.string().optional(),
  /** Supplier names from `GET /api/suppliers`, matched after normalization. Empty means all. */
  supplier: z.array(z.string().min(1, { error: "Supplier can't be empty" })),
  sort: PartSort.default("part_number"),
  dir: SortDirection.default("asc"),
  limit: z.coerce
    .number<string>()
    .pipe(
      z
        .int()
        .min(1, { error: "Limit must be between 1 and 200" })
        .max(200, { error: "Limit must be between 1 and 200" }),
    )
    .default(50),
  /** Opaque, from a previous response's `nextCursor`. The server answers `400` if it can't decode it. */
  cursor: z.string().min(1).optional(),
});
export type PartsQuery = z.infer<typeof PartsQuery>;

/**
 * Reads `PartsQuery` from a URL's search params. `supplier` repeats (`?supplier=A&supplier=B`),
 * which a plain `Object.fromEntries` would collapse to its last value.
 */
export function readPartsQuery(params: URLSearchParams) {
  const one = (name: string) => params.get(name) ?? undefined;
  return PartsQuery.safeParse({
    q: one("q"),
    supplier: params.getAll("supplier"),
    sort: one("sort"),
    dir: one("dir"),
    limit: one("limit"),
    cursor: one("cursor"),
  });
}

/** One row of the parts table. Unknown values are `null` and sort last (R2.2, A19). */
export const Part = z.object({
  id: Id,
  partNumber: z.string(),
  supplier: z.string(),
  quantity: z.int().nonnegative().nullable(),
  price: Money.nullable(),
  leadTimeDays: z.int().nonnegative().nullable(),
  lastUpdated: Timestamp,
  /** Set once the part is missing from the latest import; such parts can't be quoted (A14). */
  unavailableSince: Timestamp.nullable(),
});
export type Part = z.infer<typeof Part>;

/** `GET /api/parts`. There is no total count (D7); `nextCursor` is `null` on the last page. */
export const PartsResponse = z.object({
  items: z.array(Part),
  nextCursor: z.string().min(1).nullable(),
});
export type PartsResponse = z.infer<typeof PartsResponse>;
