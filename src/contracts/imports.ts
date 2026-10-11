/**
 * Contracts for importing the export from the app (PRD 7.2, 7.4).
 *
 * `POST /api/imports` has no request schema: its body is the raw gzip-compressed CSV, not JSON.
 */
import { z } from "zod";
import { Timestamp } from "./common";

const Count = z.int().nonnegative();

/** What one import did (PRD R1.6). */
export const ImportSummary = z.object({
  rowsRead: Count,
  duplicatesCollapsed: Count,
  /** Rejected rows, counted per reason, such as `{ "price is not a number": 120 }`. */
  rejected: z.record(z.string(), Count),
  inserted: Count,
  updated: Count,
  unchanged: Count,
  markedUnavailable: Count,
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
