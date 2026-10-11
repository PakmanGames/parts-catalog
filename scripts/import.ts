/**
 * `pnpm import:csv <file>`: imports a parts export from the command line (PRD 7.2), with the same
 * function as the upload route, and prints the R1.6 summary.
 * Exits non-zero on failure, so scripts and CI can rely on the exit code.
 */
import { createReadStream } from "node:fs";
import type { ImportSummary } from "@/contracts/imports";
import { db, pool } from "@/db";
import { importCsv } from "@/server/importer";

const [file] = process.argv.slice(2);
if (!file) {
  console.error("Usage: pnpm import:csv <path/to/parts_export.csv>");
  process.exit(2);
}

try {
  printSummary(await importCsv(db, createReadStream(file)));
} catch (error) {
  console.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}

function printSummary(summary: ImportSummary): void {
  const rejected = Object.entries(summary.rejected);
  const lines: [string, number][] = [
    ["Rows read", summary.rowsRead],
    ["Rejected", rejected.reduce((sum, [, count]) => sum + (count ?? 0), 0)],
    ...rejected.map(([reason, count]): [string, number] => [`  ${reason}`, count ?? 0]),
    ["Duplicates collapsed", summary.duplicatesCollapsed],
    ["Newest row rejected", summary.newestRejected],
    ["Inserted", summary.inserted],
    ["Updated", summary.updated],
    ["Unchanged", summary.unchanged],
    ["Marked unavailable", summary.markedUnavailable],
    ["Made available", summary.madeAvailable],
  ];
  const width = Math.max(...lines.map(([label]) => label.length));
  for (const [label, count] of lines) {
    console.log(`${label.padEnd(width)}  ${count.toLocaleString("en-US").padStart(9)}`);
  }
  console.log(
    `${"Duration".padEnd(width)}  ${`${(summary.durationMs / 1000).toFixed(1)} s`.padStart(9)}`,
  );
}
