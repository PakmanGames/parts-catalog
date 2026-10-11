/**
 * `pnpm import:csv <file>`: imports a parts export from the command line (PRD 7.2).
 *
 * Stub until WS-A replaces it with a call to the shared import function, which prints the R1.6
 * summary. Exits non-zero on failure, so scripts and CI can rely on the exit code.
 */
const [file] = process.argv.slice(2);
if (!file) {
  console.error("Usage: pnpm import:csv <path/to/parts_export.csv>");
  process.exit(2);
}

console.error(`Not implemented yet (WS-A): would import ${file}`);
process.exit(1);
