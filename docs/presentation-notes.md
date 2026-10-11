# Presentation Notes

> **Purpose:** prep for the final call: the story, the decisions, and answers to likely questions.
> **Last updated:** 2026-10-10
> IDs such as D3 or A6 point to [`PRD.md`](PRD.md) for the full reasoning.
> Numbers marked **TBD** come from the data profile (T0.1), the importer (WS-A), and the benchmark (WS-B).

## 1. The pitch (about 60 seconds)

Buyers quote from a 1.2M-row nightly ERP export that Excel can't open.
I built a small Next.js app on Postgres that imports the export from the browser, lets the buyer search, filter, and sort the whole catalog quickly, and saves quotes.
The import is one database transaction, so re-running it, even after a crash, is always safe, and the buyer never sees a half-updated catalog.
Search, filtering, and sorting stay fast at any page depth through matching indexes and keyset pagination.
Quotes keep their own copy of the agreed price, so later imports never change them.
It's deployed on Railway behind Cloudflare Access.

## 2. How I approached it

- **Requirements before code.** I wrote a PRD first and kept every confirmed fact, assumption, open question, and decision under an ID, so nothing got lost as the brief evolved.
- **Asked about what changes the design.** Part identity, full snapshot versus changes only, duplicate handling, and parts that disappear from the file were all confirmed with the interviewer early.
- **Made the rest as explicit judgment calls.** Where I didn't ask, I decided, wrote down why, and I state those calls up front (section 4).
- **Simplest design that meets the requirements.** For example, one transaction instead of batches with resume logic, and no job queue until something needs one.
- **Changed decisions when requirements changed.** The primary key moved from part number to a surrogate id once identity became supplier plus part number (D2).
- **Measured instead of guessing.** I compressed the real file before choosing the upload design, and the query design is backed by a benchmark across every filter and sort combination.
- **Built for parallel work.** I froze the schema, API contracts, and test fixtures first, then split the build into workstreams that each own their files and prove their work with tests against a real Postgres.

## 3. Architecture

```
Browser --> Cloudflare (proxy + Access login) --> Next.js on Railway --> Postgres 18
            100 MB body cap, 100 s timeout        UI + JSON API /api    private network
```

- **Tables:** `parts` (the catalog), `quotes`, and `quote_lines`.
- **`normalize_key`:** one SQL function (uppercase, keep only letters and digits) that defines "the same part number" and "the same supplier" everywhere.
- **Import:** browser gzips the CSV, `POST /api/imports` replies `202`, then a background import runs as one transaction: parse and clean, `COPY` into a temporary staging table, collapse duplicates, `MERGE` into `parts`, commit.

## 4. Judgment calls (made without asking)

| ID | Call | Why |
| --- | --- | --- |
| A2 | The latest import always wins, even if it's an older file. | The newest import is the source of truth; no cross-file timestamp logic. |
| A4 | Same part with the same timestamp: the later line in the file wins. | Deterministic, and "last write wins" matches how exports append edits. Rejecting both would wrongly mark the part unavailable. |
| A6 | Quotes may exceed stock, with a warning showing the lead time. | The brief says buyers use lead time while quoting; a hard cap would make it display-only. |
| A8 | Import from the app, not only a CLI. | The MVP had to work end to end from the browser. |
| A9 | Search matches anywhere in the part number, with no typo tolerance. | Typo ranking conflicts with sorting by quantity, price, or lead time. |
| A10 | Filter by several suppliers at once. | Better for buyers comparing sources. |
| A13 | Supplier names differing only in spaces, punctuation, or case are one supplier, shown under the newest spelling. | Supplier is part of identity; variants would split one part into several rows. |
| A14 | Parts missing from the latest file stay visible, dimmed and labeled, but can't be quoted. | The buyer can still say "we no longer carry it" without quoting it by mistake. |

## 5. Key decisions and trade-offs

- **One transaction per import, with `MERGE` (D3).**
  Gains: crash safety and consistent reads with no extra code; one statement inserts, updates, and marks missing parts unavailable.
  Costs: needs Postgres 17 or later; a long transaction holds locks on changed rows until commit.
- **Gzip in the browser, `202`, import in the background (D10).**
  Gains: 126 MB becomes about 36 MB, under Cloudflare's 100 MB cap, and the reply beats its 100-second timeout, with no new services.
  Costs: a restart mid-import loses the status, and the buyer re-uploads (the catalog is safe).
- **Keyset pagination, no total count (D6, D7).**
  Gains: page 20,000 is as fast as page 1, and rows don't repeat or skip during an import.
  Costs: no "jump to page N" and no "of 1.2M".
- **One `normalize_key` function (D13).**
  Gains: duplicate detection, search, and the supplier filter can never disagree, and normalized search terms can't contain `LIKE` wildcards.
  Costs: changing the rule needs a migration.
- **Surrogate id with a unique natural key (D2).**
  Gains: a small stable handle for quotes, cursors, and the API.
  Costs: one extra column and index.
- **Mark missing parts with `unavailable_since` instead of deleting (D14).**
  Gains: quotes keep working, and we know when a part went away.
- **Quote lines copy the unit price (D9); money is exact (D11).**
  Gains: saved quotes never change; no floating-point rounding.
  Costs: details shown beside a quote come from today's catalog.
- **Supplier as a text column, not a table (D8).**
  Gains: one catalog table, one `MERGE`.
  Costs: the name repeats on every row, and an unavailable part can show an older spelling.
- **Clean rows in TypeScript, merge in SQL (D4); only write changed rows (D5).**
  Gains: every cleaning rule is unit-tested with a reason per rejected row; re-running the same file writes nothing.
- **JSON API under `/api` (D15), tested against real Postgres (D16), behind Cloudflare Access (D17).**
  Gains: every requirement can be shown with plain HTTP calls, the UI could be built in parallel against mocks, and the site has a login with no app code.

## 6. Likely questions

**Why one transaction instead of committing in batches? What if it crashes halfway?**
A crash rolls the whole transaction back, so the catalog is exactly as it was, and re-running is the same as running fresh.
Batches would need resume logic, and buyers would see a half-old, half-new catalog while it ran.
Postgres serves the previous snapshot to readers until the commit, so browsing never stops.
An advisory lock stops two imports from overlapping.

**How is re-running the same file safe?**
`MERGE` only writes rows whose values or availability changed, so a second run of the same file writes nothing and reports zero changes.

**Why Previous/Next instead of page numbers?**
`OFFSET` reads and discards every skipped row, so deep pages get slower, and an exact count on a broad search is slow too.
Keyset paging seeks straight into the sort index, so every page costs the same.
Benchmark: deep-page `OFFSET` versus keyset is **TBD** (WS-B).

**How does every filter and sort combination stay fast?**
Each sort column has an index ending in `id`, plus versions that start with the supplier, and part numbers have a trigram index for "contains" search.
The benchmark covers no search, selective, and broad searches; no supplier, one, and three suppliers; every sort, both directions, first and deep pages.
The hardest case is a short, common search term combined with a sort, which the benchmark checks explicitly.
Results: **TBD** (WS-B).

**Why compress in the browser instead of uploading to object storage?**
The gzipped file is about 36 MB, nearly three times under Cloudflare's cap, using one built-in browser API.
Object storage adds a bucket, signed URLs, and an SDK we don't need yet.
Splitting the file was rejected: each file is a full snapshot, so importing one half would mark the other half unavailable.
I'd switch to object storage when the compressed file nears 100 MB, roughly a 300 MB raw export.

**How do "AB-123" and "ab 123" become the same part, and why does search agree?**
Both become `AB123` through `normalize_key`, stored in a generated key column with a unique constraint on supplier key plus part number key.
Search runs the buyer's term through the same function, so "ab 123" finds "AB-123-X".

**What if tonight's export is cut off halfway?**
The missing parts would be marked unavailable, not deleted.
It's recoverable: the next good import makes them available again, and quotes are unaffected.
A guard that refuses an import marking an unusually large share unavailable is in the backlog (Q14), deliberately left out of the MVP.

**What happens to a saved quote when prices change or a part disappears?**
Nothing: each line stores its own quantity and unit price, and parts are never deleted.

**Why no authentication?**
The brief says one buyer and no security requirements, so the app has no login.
A public URL would still let anyone import or quote, so Cloudflare Access puts a login in front with no app code.
Known limit: Access protects the hostname, so the deploy removes Railway's own `*.up.railway.app` domain; fully closing the gap means validating Access's signed header in the app.

**What changes at 100 times the size?**
- **Upload:** presigned uploads straight to object storage.
- **Background work:** a worker service with a job queue (pg-boss, then BullMQ on Redis), so imports survive deploys.
- **Loading:** parallel `COPY` streams into an unlogged staging table, with indexes built after the load.
- **Storage:** partition by import, and consider a columnar engine for the cleaning pass.
- **Reads:** estimated counts, possibly read replicas.

**Why this stack?**
One TypeScript codebase for UI, API, and importer, with SQL-first data access (Drizzle plus raw SQL for `COPY` and `MERGE`) and Zod validating every input.
Postgres does the heavy lifting: `COPY`, `MERGE`, trigram indexes, and transactional imports.

**How did you organize the build?**
Requirements and contracts first, then parallel workstreams that each own their files and prove their work with tests against a real Postgres in Testcontainers.
Known risks were tracked in `docs/known-issues.md` and fixed before the parallel work started.

## 7. Known limits and next steps

- Truncated-export guard (Q14).
- Worker service with pg-boss, so imports survive restarts and deploys.
- Direct-to-object-storage uploads once the compressed file nears 100 MB.
- Playwright end-to-end tests.
- Import history, for "what changed last night".
- Validating Cloudflare Access's signed header in the app.

## 8. Numbers to fill in

| Measure | Value |
| --- | --- |
| Raw file / gzipped | 126 MB / about 36 MB (measured) |
| Rows, distinct parts, duplicates, rejected rows | **TBD** (T0.1) |
| Full import time, local and deployed | **TBD** (WS-A) |
| Query p95 across the benchmark matrix | **TBD** (WS-B) |
| Deep page: `OFFSET` versus keyset | **TBD** (WS-B) |
