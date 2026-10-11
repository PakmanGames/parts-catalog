# Agent Brief: WS-A1 Read and Clean Rows

> **Task:** PRD section 10, WS-A, part A1.
> **Starts:** now.
> It doesn't wait for T0.3, and it never touches a database.
> **Read first:** [`phase-1-rules.md`](phase-1-rules.md), especially the decisions.

## Why this matters

The nightly export has about 1.2M rows, and about 1 in 20 has a problem.
Your code turns the raw bytes of `parts_export.csv` into one result per line: a clean row, or a rejection with a reason.
WS-A2 loads your clean rows into Postgres and trusts them completely, so every rule has to be exact and tested.
Your reasons are what the buyer sees in the import summary (R1.6).

## You own

- `src/server/importer/rows/`, and nothing else.
  WS-A2 owns the rest of `src/server/importer/`.

## Read first

- `docs/data-profile.md`: section 2 (file format), section 3 (columns and value shapes), and section 4.
  Section 4.2, "Normalizer steps", is your specification, with the changes below.
- `docs/PRD.md`: R1.3, R1.5, R1.6, NFR3, and step 1 of the algorithm in 7.2.

## What to build

One entry point, which WS-A2 calls:

```ts
/** Reads a parts export and yields one `NormalizedRow` per data line, in file order. */
export function readRows(input: AsyncIterable<Uint8Array>): AsyncGenerator<NormalizedRow>;
```

- **`input`:** the file's bytes.
  Node's file streams and `zlib` gunzip streams are both `AsyncIterable<Uint8Array>`, so the CLI and the upload route can both call it.
  Stream it: never hold the whole file in memory.
- **`NormalizedRow`:** frozen by T0.3 in `src/contracts/import-rows.ts`, and that file is your specification for the output.
  An accepted line is a `CleanRow`.
  A rejected line is a `RejectedRow` with its reason, and with its `identity` when its part number, supplier, and timestamp are usable, because WS-A2 needs it to find each part's newest row (A17).
  If the contract doesn't fit the rules, tell the user instead of editing it.

## Rules

Apply the steps in section 4.2 of the data profile in order, with these changes from the decisions in `phase-1-rules.md` and PRD A17 to A19.

| Step | The profile says | Do instead |
| --- | --- | --- |
| 1. Decode | Strip the BOM, and decode a field that isn't valid UTF-8 as Windows-1252. | Strip the BOM. The only non-UTF-8 bytes are in Description, which isn't stored, so decoding as UTF-8 is enough. Prove it on the full file: no kept field may contain `U+FFFD`. |
| 3. Column count | With more than 8 fields, join the middle fields as Description. | Split the same way, and discard the middle fields. Fewer than 8 fields is still rejected. |
| 5. Identity | Trim the part number. | Trim it and upper-case it. |
| 6. Values | Reject a missing or `N/A` quantity, and a missing or `CALL` price. | Store those as `null` and keep the row (A19). Every other bad value still rejects the row, as the profile says. |
| 8. Description | Trim it, and store a blank as NULL. | Drop it. NSN is dropped too. |

Dates in the future are accepted (A18).
`REJECT_REASONS` in the contract lists all 18 rejection reasons in the order they are checked, and the first failing check gives the reason.

## Things to get right

- **Every data line yields exactly one result.**
  WS-A2 reports rows read as accepted plus rejected, and the full file has 1,203,487 data lines.
  Empty lines and lines of seven commas must still yield a `row is empty` result, so make sure the CSV parser doesn't skip them.
- **`csv-parse` 7 is installed.**
  Check its documentation for the options you need, such as stripping the BOM, allowing rows with too many or too few fields, keeping empty lines, and reporting line numbers, instead of relying on memory.
- **Dates:** read `YYYY-MM-DD` and `MM/DD/YYYY` as midnight UTC, and `YYYY-MM-DDTHH:MM:SSZ` as that instant.
  Reject a date that doesn't exist, such as `02/30/2025`, by checking that it round-trips.
- **"No letters or digits":** use the same rule as the SQL `normalize_key`, upper-case and then keep only `A-Z` and `0-9`.
- **Speed:** reading and cleaning the full file should be a small part of NFR2's "a few minutes".
  Compile each regular expression once, not per row, and measure it.

## Tests

- **Unit tests for every rule:** one table-driven test per column, covering every value shape in section 3 of the data profile and every problem from P1 to P30 that still applies.
- **Every reason in `REJECT_REASONS` has a test,** including the ones that occur 0 times in this file.
- **Precedence:** a row with several problems is rejected for the first failing step.
  A row rejected for a bad value carries its `identity`, and a row rejected before its part number, supplier, and timestamp could be read doesn't.
- **Line numbers:** across the header, empty lines, long rows, and quoted fields.
- **The full file:** run `readRows` over the real export with a throwaway script outside the repo, and don't commit a test that needs the file.
  Report:
  - the total number of results, which must be 1,203,487;
  - accepted, and rejected by reason;
  - how many rejected rows carry an `identity`;
  - how many quantities, prices, and lead times are `null`;
  - the time taken and the peak memory.

  Reconcile every count with a DuckDB query, adapting the ones in section 9 of the data profile, and explain any difference.

## Done when

- `readRows` yields one result per data line, and the full file gives 1,203,487 results.
- Every rule and every reason in this brief has a unit test.
- The full-file counts are reconciled with DuckDB and listed in the PR, along with the time and memory.
- No kept field from the full file contains `U+FFFD`.
- Every result parses with `NormalizedRow` from the contract.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.

## Out of scope

Staging, deduplication, choosing supplier spellings, the summary, the routes, and the CLI all belong to WS-A2.
