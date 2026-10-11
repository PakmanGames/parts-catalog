# Agent Brief: WS-B Parts Query and Benchmark

> **Task:** PRD section 10, WS-B.
> **Starts:** when T0.3 is on `main`.
> Before then, only the prep described below.
> **Read first:** [`phase-1-rules.md`](phase-1-rules.md), especially the decisions.

## Why this matters

The buyer's main screen is a table of 1.2M parts, and every combination of search, supplier filter, sort, direction, and page depth has to stay fast (R2.5, NFR1).
Your benchmark is the evidence for the design in the presentation, including why keyset pagination beats `OFFSET` (D6).

## Before you start: has T0.3 merged?

Run `git fetch origin`, then check that on `origin/main`, `src/db/schema.ts` defines the `parts` table, and `src/contracts/` has the `GET /api/parts` contract.

**If it hasn't merged**, read everything below and plan.
You may build the pieces that need no database:

- the cursor encoding;
- the SQL builder, with unit tests on the SQL it produces;
- the benchmark script's outline.

Don't generate migrations until T0.3 has merged and you have rebased onto it (K1).
Then stop, and tell the user you're waiting for T0.3.

## You own

- `src/server/parts/`, `src/app/api/parts/`, `src/app/api/suppliers/`, and `scripts/bench/`.
- Index changes in `src/db/schema.ts`, and new migrations in `drizzle/`.
  You are the only Phase 1 workstream allowed to add migrations.
- In `docs/PRD.md`, only:
  - the index table in 7.3, updated to match the final indexes;
  - the "Query benchmark" line and its results under section 11, "Measurements".

## Read first

- **`docs/PRD.md`:**
  - requirements: R2 and NFR1;
  - design: 7.1, 7.3, and the parts and suppliers parts of 7.4;
  - decisions: D6, D7, and D13.
- **`docs/data-profile.md`:** section 6, "Distributions".
- **Code:** `src/db/schema.ts`, the parts and suppliers contracts, and `tests/db.ts`.
- **`docs/known-issues.md`:** K1.

## What to build

1. **`GET /api/parts`:**
   - It validates its query string with the contract, then calls a plain function in `src/server/parts/`.
   - The SQL is built from a whitelist of fragments, never by pasting in user input.
   - Pagination is keyset on `(sort column, id)` with `LIMIT n + 1`, and there's no total count (D6, D7).
   - The cursor is opaque to the client, for example base64url JSON.
     A cursor that doesn't decode, or that came from a different sort or direction, returns `400`.
2. **`GET /api/suppliers`:** one name per supplier, sorted by name.
3. **A seed script** in `scripts/bench/`.
   It fills `parts` with 1.2M synthetic rows using `generate_series`, shaped like section 6 of the data profile:
   - 40 suppliers of almost equal size;
   - the part number shapes and lengths;
   - quantity, price, and lead time percentiles, with lead time taking only its 16 values;
   - 12% zero stock;
   - unknown values: about 1.3% of quantities, 1.6% of prices, and 1.5% of lead times (A19);
   - a small share of unavailable parts.
4. **A benchmark script** in `scripts/bench/`.
   - It runs the matrix in PRD 7.3, plus the supplier list.
   - For each case it records `EXPLAIN (ANALYZE, BUFFERS)` and the p95 over repeated runs.
   - It also times `OFFSET` paging at the same deep page.
   - It prints a Markdown table for PRD section 11.

## Things to get right

- **Unknown values sort last in both directions (decision 6).**
  Postgres puts NULLs first in a descending sort, and so does a backward scan of an ascending index.
  So "descending, unknowns last" needs a deliberate design.
  For example:
  - add `DESC NULLS LAST` indexes;
  - or page through the known values first and then the unknown ones, as two keyset phases recorded in the cursor, which reuses the ascending indexes.

  Benchmark the options you consider, pick one, and explain why in the PR.
- **Big ties:** lead time has 16 values, and each is shared by 57,000 to 171,000 parts.
  The `id` tiebreak has to keep paging exact through them.
- **Search:**
  - Search uses `part_number_key LIKE '%' || normalize_key(q) || '%'`, and a term that normalizes to nothing means no search.
  - Terms under 3 characters can't use the trigram index.
  - A short, common term combined with a sort is the hard case named in 7.3, so benchmark it explicitly.
- **Several suppliers:** filter with `supplier_key = ANY(...)` on the normalized names, and check the plans for one and for three suppliers.
- **The supplier list:**
  - It has one entry per `supplier_key`.
  - The import stores each supplier's current display spelling on its rows (decision 4).
    An unavailable part can keep an older spelling, so prefer the spelling from available parts.
  - It reads a 1.2M-row table to find 40 names, so it must meet NFR1 too.
    A recursive query that jumps from one supplier to the next in an index (a "loose index scan") is one way.
- **Sorting by part number** uses `part_number_key`.
- **Check the plans:** confirm with `EXPLAIN` that each case uses the index you expect, and record the plan in the results.

## Done when

- Integration tests prove that paging through every sort, in both directions, never repeats or skips a row.
  That includes long runs of ties, and the boundary between known and unknown values.
- Unknown values come last in both directions.
- Integration tests prove that search and the supplier filter ignore spaces, punctuation, and case, and that `%` and `_` in a search term never act as wildcards.
- Filtering by several suppliers returns exactly those suppliers' parts.
- Unavailable parts are returned with their `unavailableSince`.
- A malformed or mismatched cursor returns `400`.
- Every benchmark case and the supplier list meet NFR1 (p95 under 200 ms at 1.2M rows).
  Any case that misses is listed with its plan and a proposed fix.
- The results table, including the `OFFSET` comparison, is in PRD section 11, and 7.3 matches the final indexes.
- New migrations were generated with `pnpm db:generate` after rebasing onto the latest `main`, and they apply cleanly on a fresh database.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass, and `pnpm build` lists both routes as dynamic (`ƒ`).

## Out of scope

Total counts, typo-tolerant search, and the UI.
Re-running the benchmark on the real imported data happens in Phase 2 (T2.1).
