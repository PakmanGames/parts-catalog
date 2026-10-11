/**
 * The import (PRD 7.2): the one function both `POST /api/imports` and `pnpm import:csv` call.
 * WS-A1's `readRows` cleans each line, and `importRows` loads the result.
 */
import type { ImportSummary } from "@/contracts/imports";
import type { Db } from "@/db";
import { importRows } from "./load";
import { readRows } from "./rows";

export { ImportAlreadyRunningError } from "./load";

/** Imports a parts export from its CSV bytes, which it streams, and returns the R1.6 summary. */
export function importCsv(db: Db, csv: AsyncIterable<Uint8Array>): Promise<ImportSummary> {
  return importRows(db, readRows(csv));
}
