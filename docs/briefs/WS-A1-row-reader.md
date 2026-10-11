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
/** The result for one data line of the file. */
export type RowResult =
  | { line: number; ok: true; row: CleanRow; cleared: string[] }
  | { line: number; ok: false; reason: string };

/** Reads a parts export and yields one result per data line, in file order. */
export function readRows(input: AsyncIterable<Uint8Array>): AsyncGenerator<RowResult>;
```

- **`input`:** the file's bytes.
  Node's file streams and `zlib` gunzip streams are both `AsyncIterable<Uint8Array>`, so the CLI and the upload route can both call it.
  Stream it: never hold the whole file in memory.
- **`line`:** the physical line where the record starts, counting the header as line 1, so error messages point at real lines.
- **`cleared`:** one reason for each value set to unknown, using the reason texts below, such as `quantity is negative`.
- **`reason`:** the rejection reason, from the list below.
- **`CleanRow`:** T0.3 is freezing this type in `src/contracts/`.
  Until it lands, use a local type with exactly these fields, then switch to T0.3's type.
  If T0.3's type doesn't fit these rules, tell the user instead of editing it.

  | Field | Type | Value |
  | --- | --- | --- |
  | `partNumber` | `string` | Trimmed and upper-cased. |
  | `supplier` | `string` | Trimmed, with each run of whitespace collapsed to one space, and the case kept as written. WS-A2 picks each supplier's display spelling from these. |
  | `quantity` | `number \| null` | Whole units. |
  | `price` | `string \| null` | An exact decimal string with two decimals, such as `"18.10"`. Never a JavaScript number. |
  | `leadTimeDays` | `number \| null` | Whole days. |
  | `lastUpdated` | `Date` | In UTC. |

## Rules

Apply the steps in section 4.2 of the data profile in order, with these changes from the decisions.

| Step | The profile says | Do this instead |
| --- | --- | --- |
| 1. Decode | Strip the BOM, and decode a field that isn't valid UTF-8 as Windows-1252. | Strip the BOM. The only non-UTF-8 bytes are in Description, which isn't stored, so decoding as UTF-8 is enough. Prove it on the full file: no kept field may contain `U+FFFD`. |
| 3. Column count | With more than 8 fields, join the middle fields as Description. | Split the same way, and discard the middle fields. Fewer than 8 fields is still rejected. |
| 5. Identity | Trim the part number. | Trim it and upper-case it. |
| 6. Values | Reject a quantity or price that is missing, `N/A`, `CALL`, negative, not a number, has too many decimals, or is too large. | Set that one value to NULL, keep the row, and add the reason to `cleared`. A blank or `TBD` lead time also gets a reason, so every NULL is explained. |
| 7. Last updated | Reject a missing or invalid date. | No change. Dates in the future are accepted. |
| 8. Description | Trim it, and store a blank as NULL. | Drop it. NSN is dropped too. |

So a row is only ever rejected for one of these reasons, checked in this order:

1. `row is empty`
2. `row has too few columns`
3. `row is a repeated header`
4. `part number is missing`
5. `part number has no letters or digits`
6. `supplier is missing`
7. `supplier has no letters or digits`
8. `last updated is missing`
9. `last updated is not a valid date`

And a value is set to unknown for one of these reasons:

- **Quantity:** `quantity is missing` (blank or `N/A`), `quantity is negative`, `quantity is not a whole number`, `quantity is too large`.
- **Price:** `price is missing`, `price is CALL`, `price is negative`, `price is not a number`, `price has more than 2 decimal places`, `price is too large`.
- **Lead time:** `lead time is missing` (blank or `TBD`), `lead time is not a number of days or weeks`, `lead time is too large`.

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
- **Every reason above has a test,** including the ones that occur 0 times in this file.
- **Precedence:** a row with several problems is rejected for the first failing step.
  A row that is kept reports every value it cleared.
- **Line numbers:** across the header, empty lines, long rows, and quoted fields.
- **The full file:** run `readRows` over the real export with a throwaway script outside the repo, and don't commit a test that needs the file.
  Report:
  - the total number of results, which must be 1,203,487;
  - accepted, and rejected by reason;
  - values cleared, by reason;
  - the time taken and the peak memory.

  Reconcile every count with a DuckDB query, adapting the ones in section 9 of the data profile, and explain any difference.

## Done when

- `readRows` yields one result per data line, and the full file gives 1,203,487 results.
- Every rule and every reason in this brief has a unit test.
- The full-file counts are reconciled with DuckDB and listed in the PR, along with the time and memory.
- No kept field from the full file contains `U+FFFD`.
- The result uses T0.3's clean row type if T0.3 has merged by the time you finish.
  Otherwise it uses the local type, and the PR says so.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.

## Out of scope

Staging, deduplication, choosing supplier spellings, the summary, the routes, and the CLI all belong to WS-A2.
