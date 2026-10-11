# Agent Brief: WS-A2 Load the Import

> **Task:** PRD section 10, WS-A, part A2.
> **Starts:** when T0.3 is on `main`.
> Before then, only the prep described below.
> **Read first:** [`phase-1-rules.md`](phase-1-rules.md), especially the decisions.

## Why this matters

This is the heart of the project.
The import has to bring 1.2M rows into Postgres in a few minutes.
Re-running it, even after a crash, must always be safe, and the buyer must never see a half-applied import.
It's also the part the presentation leans on most: one transaction, one `MERGE`, and a summary that accounts for every row.

## Before you start: has T0.3 merged?

Run `git fetch origin`, then check that on `origin/main`:

- `src/db/schema.ts` defines the `parts`, `quotes`, and `quote_lines` tables;
- `tests/fixtures/` has the night 1 and night 2 CSV fixtures and their expected states.

**If it hasn't merged**, read everything below and plan.
You may build the pieces that don't depend on T0.3's files: the import status store, the upload route's size and gzip checks, and the CLI's argument handling.
Don't create tables or contracts yourself, since T0.3 is writing them.
Then stop, and tell the user you're waiting for T0.3.

## You own

- `src/server/importer/`, except `src/server/importer/rows/`, which belongs to WS-A1.
- `src/app/api/imports/`.
- `scripts/import.ts`.
- In `docs/PRD.md`, only the "Import" line under section 11, "Measurements".

## Read first

- **`docs/PRD.md`:** all of R1, NFR2, NFR3, 7.1, 7.2, and the imports part of 7.4.
- **`docs/data-profile.md`:** section 5, "Identity and duplicates".
- **Contracts:** `src/contracts/imports.ts` and the clean row type from T0.3.
- **Your input:** the "What to build" section of [`WS-A1-row-reader.md`](WS-A1-row-reader.md).
  `readRows` yields one result per data line.

## What to build

1. **One import function** that both the upload route and the CLI call.
   It takes the CSV's bytes as an `AsyncIterable<Uint8Array>`, passes them through `readRows`, loads the clean rows, and returns the R1.6 summary.
2. **The loader:** steps 2 and 3 of the algorithm in PRD 7.2, with these changes:
   - **Supplier spelling (decision 4):** step 5 uses each supplier's most common spelling among this file's accepted rows, not the spelling from its newest row.
     Break ties with a fixed rule, such as alphabetical order, and test it.
     Don't rely on Postgres's `mode()` for ties: its documentation says it picks among equally frequent values arbitrarily.
   - **NULL-safe change detection:** quantity, price, and lead time can be NULL (decision 2).
     Compare every stored value, including the display spellings, with `IS DISTINCT FROM`.
     With `<>`, a change from 5 to NULL compares as NULL, so the update would be skipped.
   - **Never write the generated key columns:** Postgres computes `supplier_key` and `part_number_key` itself.
3. **The summary:**
   - `rowsRead` is the number of results from `readRows`, so accepted plus rejected always equals it.
   - `rejected` counts rejected rows by reason.
   - `duplicatesCollapsed` is the number of accepted rows minus the number of distinct parts.
   - The part counts come from `MERGE ... RETURNING merge_action()`.
     Telling "made available again" apart from other updates needs the row's old `unavailable_since`.
     Postgres 18's `RETURNING` can read old values; confirm the syntax in its documentation.
   - **Values set to unknown and future-dated rows:** if T0.3's frozen `ImportSummary` has fields for them, fill them.
     If it doesn't, tell the user before building around the gap.
     NFR3 says nothing is silently corrupted, so every value set to NULL should be visible somewhere.
4. **Import status:** idle, running, succeeded, or failed, stored on `globalThis` so every route handler sees the same object (7.2).
5. **`POST /api/imports`:**
   - Return `413` for a body over 100 MB.
   - Return `400` if the body doesn't start with gzip's magic bytes (`1f 8b`).
   - Return `409` while an import is running.
   - Otherwise, hold the body in memory, respond `202` with the status, and run the import in the background.
     Next.js's `after()` is one way to do that; read the Next.js 16 documentation first.
   - Decompression errors later in the stream make the import fail with a clear message.
6. **`GET /api/imports/latest`:** returns the status, matching `ImportStatusResponse`.
7. **`pnpm import:csv <file>`:** replace the stub in `scripts/import.ts`.
   It should read a plain CSV file, print the summary, and exit non-zero on failure.

## Things to get right

- **One transaction, on one connection:** `COPY` and the `MERGE` must share it (D3).
  Escape values correctly for `COPY`, and write NULLs as NULL, not as empty strings.
- **Two imports at once:** the `409` check only covers this web process.
  The advisory lock also covers the CLI running at the same time as an upload.
  Decide whether a second import waits for the lock or fails fast with `pg_try_advisory_xact_lock`, and say which in the PR.
- **Re-running the same file writes nothing (D5),** including when some values are NULL.
- **Run `ANALYZE parts` after the commit.**

## Working before WS-A1 lands

Test the loader by passing it clean rows directly.
When WS-A1 merges, connect `readRows` and add the end-to-end fixture tests.
Never write your own CSV cleaning: one set of rules lives in `src/server/importer/rows/`.

## Done when

The PRD's WS-A list, minus the normalizer's unit tests, which are WS-A1's, plus the decisions:

- Importing night 1 and then night 2 produces exactly the expected database state after each.
- Part number variants that differ only in spaces, punctuation, or case collapse into one part, and the newest timestamp wins.
- When duplicates share a timestamp, the row later in the file wins (A4).
- A newest row with unknown values beats an older row with good values (decision 2).
- A future-dated row wins when it's the newest (decision 3).
- Supplier variants collapse into one supplier shown under its most common spelling, and ties go the same way every time (decision 4).
- A change from a value to NULL, and from NULL to a value, counts as an update.
- Parts missing from night 2 are marked unavailable, and parts that come back are available again.
- A second import of the same file reports nothing inserted, updated, marked unavailable, or made available, and a checksum over `parts` doesn't change.
- Killing the process mid-import leaves the database unchanged, and re-running it gives the same state as an uninterrupted run.
- Uploading a gzipped fixture to `POST /api/imports` returns `202`, and `GET /api/imports/latest` then reports the summary.
  A second upload during an import returns `409`.
- The full 1.2M-row export imports through `pnpm import:csv`, and again through a gzipped upload.
  The time and the summary are in the PR, and the time is on the "Import" line in PRD section 11.
  A second run reports no changes.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass, and `pnpm build` lists both import routes as dynamic (`ƒ`).

## Out of scope

Import history tables, a worker service, and protection against truncated exports (PRD section 12 and Q14).
