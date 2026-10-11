/**
 * Contracts for importing the export from the app (PRD 7.2, 7.4).
 *
 * `POST /api/imports` has no request schema: its body is the raw gzip-compressed CSV, not JSON.
 */
import { z } from "zod";
import { Timestamp } from "./common";
import { RejectReason } from "./import-rows";

const Count = z.int().nonnegative();

/**
 * What one import did (PRD R1.6).
 *
 * The counts always add up, which tests can rely on:
 * - `rowsRead` = accepted rows + every count in `rejected`.
 * - accepted rows = `inserted` + `updated` + `unchanged` + `madeAvailable` + `duplicatesCollapsed`.
 */
export const ImportSummary = z.object({
  /** Data lines after the header, including empty ones. */
  rowsRead: Count,
  /**
   * Accepted rows that lost to a newer row of the same part (C3, A4), including rows of a part whose
   * newest row was rejected (A17).
   */
  duplicatesCollapsed: Count,
  /** Rejected rows per reason, listing only reasons that occurred, such as `{ "price is negative": 3 }`. */
  rejected: z.partialRecord(RejectReason, Count),
  /** Parts in the file whose newest row was rejected, so the import treated them as absent (A17). */
  newestRejected: Count,
  /** Parts that weren't in the catalog before. */
  inserted: Count,
  /** Available parts whose values or display spellings changed. */
  updated: Count,
  /** Available parts whose values didn't change, so nothing was written (D5). */
  unchanged: Count,
  /** Available parts missing from the file, or whose newest row was rejected (C11, A17). */
  markedUnavailable: Count,
  /** Unavailable parts that are back in the file, whether or not their values changed (A15). */
  madeAvailable: Count,
  durationMs: Count,
});
export type ImportSummary = z.infer<typeof ImportSummary>;

/**
 * `GET /api/imports/latest`, which is also the `202` body of `POST /api/imports`.
 *
 * Every field is always present, as in the PRD example, but it is a union on `status`, so each state
 * carries only what it can have: a summary once the import succeeds, and an error once it fails.
 * That lets the UI narrow on `status` without checking for impossible combinations.
 */
export const ImportStatusResponse = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("idle"),
    startedAt: z.null(),
    finishedAt: z.null(),
    summary: z.null(),
    error: z.null(),
  }),
  z.object({
    status: z.literal("running"),
    startedAt: Timestamp,
    finishedAt: z.null(),
    summary: z.null(),
    error: z.null(),
  }),
  z.object({
    status: z.literal("succeeded"),
    startedAt: Timestamp,
    finishedAt: Timestamp,
    summary: ImportSummary,
    error: z.null(),
  }),
  z.object({
    status: z.literal("failed"),
    startedAt: Timestamp,
    finishedAt: Timestamp,
    summary: z.null(),
    error: z.string(),
  }),
]);
export type ImportStatusResponse = z.infer<typeof ImportStatusResponse>;
export type ImportStatus = ImportStatusResponse["status"];
