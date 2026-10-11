/**
 * The contract between the two halves of the import (PRD 7.2): the normalizer turns each CSV line
 * into a `NormalizedRow`, and the loader stages, deduplicates, and merges them.
 * The rule behind every field is in docs/data-profile.md, section 4.2.
 */
import { z } from "zod";
import { MoneyInput } from "./common";

/**
 * Why a line was rejected, in the order the normalizer checks them, so the first failing check
 * gives the reason (docs/data-profile.md, section 4.3). These are the keys of `ImportSummary.rejected`.
 * Unknown quantities and prices are not here: they become `null` (A19).
 */
export const REJECT_REASONS = [
  "row is empty",
  "row has too few columns",
  "row is a repeated header",
  "part number is missing",
  "part number has no letters or digits",
  "supplier is missing",
  "supplier has no letters or digits",
  "quantity is negative",
  "quantity is not a whole number",
  "quantity is too large",
  "price is negative",
  "price is not a number",
  "price has more than 2 decimal places",
  "price is too large",
  "lead time is not a number of days or weeks",
  "lead time is too large",
  "last updated is missing",
  "last updated is not a valid date",
] as const;

export const RejectReason = z.enum(REJECT_REASONS);
export type RejectReason = z.infer<typeof RejectReason>;

/** The largest value of a Postgres `integer`, the type of quantity and lead time. */
const MAX_INTEGER = 2_147_483_647;

/** The physical line in the file: the header is line 1, and empty lines count too. */
const LineNumber = z.int().min(2);

/** Display spellings, as the normalizer writes them for both clean and rejected rows. */
const Identity = {
  /** Trimmed and upper-cased (A13), with at least one letter or digit. */
  partNumber: z.string().min(1),
  /** Trimmed, with each run of whitespace collapsed to one space, and at least one letter or digit. */
  supplier: z.string().min(1),
  /** Midnight UTC for a date without a time (docs/data-profile.md, P28). */
  lastUpdated: z.date(),
};

/** A row the loader imports. */
export const CleanRow = z.object({
  lineNumber: LineNumber,
  ...Identity,
  /** `null` when the file left it blank or wrote `N/A` (A19). */
  quantity: z.int().min(0).max(MAX_INTEGER).nullable(),
  /** A canonical decimal string such as `"18.1"` or `"0.40"`; `null` for blank or `CALL` (A19). */
  price: MoneyInput.nullable(),
  /** Whole days. `STOCK` is 0; blank and `TBD` are `null`. */
  leadTimeDays: z.int().min(0).max(MAX_INTEGER).nullable(),
});
export type CleanRow = z.infer<typeof CleanRow>;

/** A row the loader doesn't import, but still counts in the summary (R1.6). */
export const RejectedRow = z.object({
  lineNumber: LineNumber,
  reason: RejectReason,
  /**
   * The row's part and timestamp, when it has a usable part number, supplier, and timestamp and was
   * rejected only for a bad value. The loader still uses it to find each part's newest row: if a
   * rejected row is the newest, the part counts as absent from the file (A17).
   * `null` when the row was rejected before those could be read, or its timestamp is unusable.
   */
  identity: z.object(Identity).nullable(),
});
export type RejectedRow = z.infer<typeof RejectedRow>;

export const NormalizedRow = z.discriminatedUnion("outcome", [
  CleanRow.extend({ outcome: z.literal("accepted") }),
  RejectedRow.extend({ outcome: z.literal("rejected") }),
]);
export type NormalizedRow = z.infer<typeof NormalizedRow>;
