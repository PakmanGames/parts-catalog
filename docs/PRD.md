# Parts Catalog - Product Requirements

> **Status:** Draft v0.6 - living doc, updated as new context comes in.
> **Last updated:** 2026-10-10

## How to use this doc

This is the main record of scope, assumptions, decisions, and the build plan.
Sections marked **TBD** are waiting on more context.
Confirmed facts (`C#`), assumptions (`A#`), open questions (`Q#`), and decisions (`D#`) have IDs so they can be referenced from code reviews and the presentation.
IDs are never reused: when something is resolved or retired, it is marked as such instead of being renumbered.
Each significant choice goes into the [Decision log](#9-decision-log) with the alternatives and the trade-off, because the presentation is about the reasoning as much as the result.
Technology details and the alternatives considered for each library live in [`docs/tech-stack-research.md`](tech-stack-research.md).

**For an agent picking up a workstream:**
Read sections 4 to 7 for what to build and which contracts to follow.
Then read only your own workstream in [section 10](#10-work-breakdown).
Only edit paths your workstream owns.
If a contract in section 7 looks wrong, raise it instead of changing it yourself, since other workstreams are building against it.

## 1. Context

A distributor gets a nightly export from a legacy ERP listing every part its suppliers carry, about 1.2 million rows.
Buyers use this data to look up stock, price, and lead time while quoting customers.
Today they open the file in Excel, and Excel can't handle it.

We are building a small web app backed by Postgres to replace that Excel workflow.
The rest of the stack, the schema, and the routes are up to us, but every choice needs a stated reason.
The UI is also open-ended and matters less than meeting the import, table, and quote requirements.

The interviewer's original brief is in [Appendix A](#appendix-a-original-brief).

## 2. Users and core job

**The buyer.**
There is only one buyer, so we don't need accounts, roles, or handling for two people editing at once.
The buyer is talking to a customer and needs to answer "do we have it, what does it cost, and how soon can we get it" within seconds.
Then they turn that answer into a quote.

Core loop:

1. Upload the latest export when it arrives.
2. Find a part by partial part number, optionally narrowed to one supplier.
3. Compare the options by sorting on stock quantity, price, or lead time.
4. Select one or more rows and turn them into a quote for a named customer.
5. Open that quote again later.

**The nightly import.**
A new `parts_export.csv` with the full catalog is produced every night.
The buyer uploads it in the app, and the parts table shows the new data once the import finishes.
It must be safe to re-run, whether on the same file or after a crash part-way through.

## 3. Goals and non-goals

### Goals

- **G1.** Import the nightly snapshot reliably from the app, so that re-running it is always safe.
- **G2.** Let the buyer find and compare parts across 1.2M rows at interactive speed.
- **G3.** Let the buyer create, save, and come back to a quote without changing catalog data.
- **G4.** Keep the schema and code as simple as the requirements allow, and justify each choice.
- **G5.** Deploy the app to a private URL.
  This is the lowest-priority goal and must never delay G1 to G4.

### Non-goals

Confirmed by the interviewer:

- Security, authentication, or user accounts in the app.
  The deployed site still sits behind Cloudflare Access, which needs no app code (D17).
- A polished UI, as long as it works and is clear.

Assumed:

- Any quote workflow beyond create and view, such as editing, statuses, approvals, or export.
- Pricing logic such as markup rules or customer-specific pricing.
- Live sync with the ERP.
- Reserving or decrementing inventory.
- Import history or audit tables, since the app shows the latest import's summary instead.
- Production hardening such as scaling, monitoring, and backups.

Deferred until after the MVP: see the [Post-MVP backlog](#12-post-mvp-backlog).

## 4. Functional requirements

### R1. Import `parts_export.csv`

**R1.1 Load the full snapshot.**

- Loads the full ~1.2M-row file into Postgres within NFR2.
- Each nightly file is a full snapshot of the catalog (C1).

**R1.2 Bring the catalog in line with the snapshot.**

- A part not yet in the database is inserted.
- A part already in the database is updated if any of its values differ, and left untouched otherwise.
- A part in the database that is missing from the file is kept and marked as no longer available, with the time it was first found missing (C11).
- A part marked unavailable that appears in a later file becomes available again (A15).

**R1.3 One row per part.**

- A part is identified by its supplier and part number together (C2).
- Part numbers that differ only in spaces, punctuation, or letter case are the same part number (C10, C12).
- Supplier names that differ only in spaces, punctuation, or letter case are the same supplier, shown under the spelling from that supplier's newest row (A13, judgment call).
- When the file repeats a part, the row with the newest last-updated timestamp wins, wherever it sits in the file (C3).
- Repeated rows with the same timestamp are resolved deterministically (A4, Q3).
- The database never holds two rows for the same part.

**R1.4 Safe to re-run.**

- Re-importing the same file changes nothing, including the times recorded for parts already marked unavailable.
- If an import crashes part-way, re-running it produces the same final state as an uninterrupted run (C4).
- The newest import is the source of truth (C4, A2).

**R1.5 Bad rows don't break the import.**

- A malformed row is normalized when its intended value is unambiguous, and rejected with a reason otherwise.
- One bad row never aborts the whole file.

**R1.6 The import reports what it did.**

- Counts of rows read, duplicates collapsed, and rows rejected (grouped by reason).
- Counts of parts inserted, updated, unchanged, marked unavailable, and made available again.
- The duration.
- The app shows this summary when an upload finishes (R1.8), and the CLI prints it.

**R1.7 The buyer isn't disrupted.**

- Reads never see a half-applied import.
- Browsing keeps working while an import runs.

**R1.8 Import from the app.**

- The buyer chooses `parts_export.csv` in the app, and the app uploads it and runs the import (A8, judgment call).
- The app shows that the import is running, then shows the R1.6 summary, or the error if it failed.
- When the import succeeds, the parts table shows the new data without a manual page reload.
- Starting an upload while another import is running is refused with a clear message.
- The upload works through Cloudflare's 100 MB request body limit and 100-second response timeout (D10).

### R2. Browse, search, filter, sort

**R2.1 Parts table with server-side pagination.**

- Columns are at least part number, supplier, quantity, price, lead time, and availability.
- The final column list is decided in T0.3, after profiling.
- Parts that are no longer available still appear in the table and in search results, dimmed and labeled (A14, judgment call).

**R2.2 Sort by quantity, price, or lead time, ascending or descending.**

- Ordering is deterministic: ties are broken by a stable key, so rows never repeat or go missing between pages.
- Missing values have a fixed position, for example unknown lead time always sorts last.

**R2.3 Search by partial part number.**

- The search term is normalized the same way as part numbers (C10, C12), so "ab 123" finds "AB-123-X".
- It matches anywhere in the part number (A9, Q5).

**R2.4 Filter by supplier.**

- Single-select from the list of suppliers (A10, Q6).
- Each supplier appears once in the list, under the spelling from its newest row (A13).

**R2.5 Every combination stays fast.**

- Every combination of search, supplier filter, sort, direction, and page position meets NFR1 at 1.2M rows, including deep pages.

### R3. Quotes

**R3.1 Select parts.**

- The buyer selects rows in the parts table.
- The selection persists across pages and searches, so one quote can collect parts from several lookups (A5).
- Parts that are no longer available can't be selected (A14, judgment call).

**R3.2 Create a quote.**

- A quote has a customer name and one or more lines.
- Each line has a part, a quantity, and a unit price.
- Unit price defaults to the part's price from the file, and the buyer can edit it (C6).
- Validation: the customer name is required, quantity is a positive integer, unit price is non-negative, there is at least one line, each part appears at most once, and every part is currently available.
- Line totals and the quote total are calculated from the lines and shown.

**R3.3 Save and view later.**

- A saved quote is stored in Postgres and can be opened from a list of quotes.

**R3.4 Creating a quote never changes catalog data.**

- Creating a quote only writes to the quote tables (C7).

**R3.5 Imports never change saved quotes.**

- A saved quote's parts, quantities, and unit prices stay exactly as saved, no matter what later imports do, including when a quoted part later becomes unavailable.
- This follows from R3.3: a quote that changes after it is saved hasn't really been saved.

## 5. Non-functional requirements

- **NFR1 Query latency:** p95 server time under 200 ms for every search, filter, sort, and page combination on 1.2M rows, measured on a laptop.
  This target is our assumption (Q9).
- **NFR2 Import time:** a full 1.2M-row import finishes within a few minutes on a laptop.
  The exact target is set after WS-A's first measurement.
- **NFR3 Correctness over coverage:** data is never silently corrupted, and every rejected row is reported.
- **NFR4 Exact money:** prices and totals are `numeric` in Postgres and decimal strings in JSON, never floats.
- **NFR5 Simplicity:** use the fewest tables, columns, indexes, services, and moving parts that meet the requirements.
  Every table, index, and service needs a stated reason.
- **NFR6 Reproducible setup:** a fresh clone gets Postgres and the app running with documented commands, and an import can be run from the app or from one CLI command.
- **NFR7 Tested:** each workstream proves its "done when" list with automated tests against a real Postgres 17 (D16).
  Browser tests are deferred (section 12).

## 6. Data

### What we know

- The file is `parts_export.csv`, generated nightly as a full snapshot, with about 1.2M rows.
- It is about 126 MB, and about 36 MB after gzip at its default level (45 MB at the fastest level), measured on the generated file.
- A part's identity is its supplier plus its part number, with spaces, punctuation, and case ignored in both.
- Each row has a last-updated timestamp, which decides between duplicates.
- The file repeats parts, sometimes with different formatting of the same part number.
- The generator describes the file as "the messy supplier parts export", so expect data quality problems.
- `python3 generate_mock_data.py` writes the file to `mock_data/mock_a/parts_export.csv`.
  Use `--rows 100000` for a smaller file while iterating.

### To learn by profiling (T0.1)

- The exact header, columns, and the target type for each column.
- Formats for quantity, price, lead time, and the last-updated timestamp, including time zones.
- Blanks, nulls, sentinel values, whitespace, casing, and encoding problems.
- Supplier name spellings, as a sanity check that A13's rule doesn't merge two genuinely different suppliers.
- Which characters appear in part numbers, and whether any part number has no letters or digits at all.
- How often duplicates occur after normalization, and whether duplicates ever share a timestamp (Q3).
- Distributions: number of suppliers, rows per supplier, and part number length and shape, which WS-B needs to build realistic benchmark data.

### Practice ground rules

- Don't read `generate_mock_data.py` past its docstring, because the code reveals the data traps.
  Find them by profiling the generated output instead.
- Don't open `mock_data/_answer_keys/` until after presenting.

## 7. Design and contracts

**Status:** Draft.
These contracts are frozen at the end of Phase 0 (T0.3), after profiling.
After that, any change goes through this doc first.

### 7.1 Schema

The schema has one SQL function and three tables: `parts`, `quotes`, and `quote_lines`.
It requires Postgres 17 (D3), which is the version Railway provides.

```sql
-- The single definition of "the same" for part numbers and supplier names (C10, C12, A13, D13).
-- Used by the key columns, by import deduplication, and by search and filtering, so they can never disagree.
CREATE FUNCTION normalize_key(raw text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN regexp_replace(upper(raw), '[^A-Z0-9]', '', 'g');

-- Catalog: one row per (normalized supplier, normalized part number).
-- Rows are never deleted, so an id always refers to the same part (D2, D14).
CREATE TABLE parts (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier          text NOT NULL,  -- spelling from the supplier's newest row, for display (A13, D8)
  supplier_key      text NOT NULL GENERATED ALWAYS AS (normalize_key(supplier)) STORED,
  part_number       text NOT NULL,  -- as written in the winning row, for display
  part_number_key   text NOT NULL GENERATED ALWAYS AS (normalize_key(part_number)) STORED,
  quantity          integer NOT NULL,
  price             numeric(12, 2) NOT NULL,  -- scale confirmed in T0.3
  lead_time_days    integer,                  -- nullability confirmed in T0.3
  last_updated      timestamptz NOT NULL,
  unavailable_since timestamptz,              -- NULL while the part is in the latest file (C11, D14)
  -- remaining columns decided in T0.3
  UNIQUE (supplier_key, part_number_key)
);

CREATE TABLE quotes (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_name text NOT NULL CHECK (btrim(customer_name) <> ''),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Each line keeps its own copy of the agreed unit price, so later imports can't change it (D9).
CREATE TABLE quote_lines (
  quote_id   bigint NOT NULL REFERENCES quotes (id),
  part_id    bigint NOT NULL REFERENCES parts (id),
  quantity   integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (quote_id, part_id)
);
```

- A part's `supplier_key` and `part_number_key` never change after it is created.
  That makes it safe for a quote to show the supplier and part number by joining to `parts`.
  Only display spellings can change, when a later file writes them differently.
- Totals are calculated when a quote is read, not stored, so they can never disagree with the lines.
- The staging table used by the import is a temporary table, not part of the schema (7.2).
- In Drizzle, `CREATE EXTENSION pg_trgm` and `normalize_key` go in a hand-written migration that runs before the one creating `parts`, since drizzle-kit can't express either.

### 7.2 Import

**Entry points (D10).**
The import is one function that takes a CSV stream, with two thin callers:

- **Upload:** `POST /api/imports` receives the gzip-compressed CSV, holds it in memory (about 36 MB), and responds `202`.
  It then decompresses it and runs the import in the background, for example with Next.js `after()`.
  Responding before importing keeps the request well inside Cloudflare's 100-second timeout.
- **CLI:** `pnpm import <file>` runs the same function in the foreground and prints the summary, for development and tests.

Only one import runs at a time.
The latest import's status lives in server memory, stored on `globalThis` so that every route handler sees the same object.
If the server restarts mid-import, the transaction rolls back, the catalog is unchanged, and the buyer uploads again.

**Algorithm.**

1. Stream-parse the CSV with `csv-parse` and normalize each row's fields in application code (D4).
   The normalizer is a pure function that turns a raw row into either a clean row or a rejection reason.
   It keeps the trimmed part number and supplier name as written, and rejects a row if either has no letters or digits.
2. In a single transaction on one dedicated connection, since `COPY` and the transaction must share it (D3):
   1. Take a transaction-level advisory lock so two imports can't interleave.
   2. Create a temporary staging table that is dropped on commit.
   3. `COPY` the clean rows into staging, including each row's line number in the file.
   4. Collapse duplicates with `DISTINCT ON (normalize_key(supplier), normalize_key(part_number))`, keeping the newest `last_updated` and breaking ties by the later line number (A4).
   5. Replace each row's supplier spelling with the spelling from that supplier's newest row, using `first_value(supplier) OVER (PARTITION BY normalize_key(supplier) ORDER BY last_updated DESC, line_number DESC)` (A13).
   6. `MERGE` the result into `parts` on `(supplier_key, part_number_key)`:
      - **Not in `parts`:** insert it.
      - **In both, and values differ or the part was unavailable:** update the values and clear `unavailable_since`.
      - **In `parts` but not in the file, and still available:** set `unavailable_since = now()`.
      - **Anything else:** write nothing, which is what makes re-running the same file a no-op (D5).
   7. Commit, then run `ANALYZE parts`.
3. Record the R1.6 summary, using `MERGE ... RETURNING merge_action()` for the counts.

A part missing from the file keeps the supplier spelling it already had.
So an unavailable part can show an older spelling of its supplier, which we accept to keep the import to one `MERGE`.

### 7.3 Parts query

```sql
SELECT id, part_number, supplier, quantity, price, lead_time_days, last_updated, unavailable_since
FROM parts
WHERE part_number_key LIKE '%' || normalize_key(:q) || '%'  -- only when q is given
  AND supplier_key = normalize_key(:supplier)                -- only when supplier is given
  AND (:sort_col, id) > (:cursor_value, :cursor_id)          -- keyset, flipped for desc
ORDER BY :sort_col :dir, id :dir
LIMIT :limit + 1;                                            -- the extra row tells us whether a next page exists
```

- The SQL is built from a whitelist of fragments, not catch-all `(:q IS NULL OR ...)` predicates, so the planner always sees the real query.
- The normalized search term contains only letters and digits, so it can never contain `LIKE` wildcards and needs no escaping.
- A search term that normalizes to an empty string is treated as no search.
- Sorting by part number sorts by `part_number_key`.
- Unavailable parts are included in results, so availability adds no filter and needs no index (A14).
- Pagination is keyset with `id` as the tiebreaker (D6), and there is no exact total count (D7).
- If lead time can be missing, the keyset condition has to treat `NULL` explicitly so that missing values always sort last.
- The supplier list is one row per `supplier_key`, showing the spelling with the newest `last_updated`.
  It scans `parts`, so WS-B has to check it meets NFR1 too.

Initial index plan, written into the schema by T0.3 and then confirmed or replaced by WS-B's benchmark:

| Index | Serves |
| --- | --- |
| `(quantity, id)`, `(price, id)`, `(lead_time_days, id)`, `(part_number_key, id)` | Each sort with no supplier filter, in both directions (backward scan). |
| `(supplier_key, quantity, id)`, `(supplier_key, price, id)`, `(supplier_key, lead_time_days, id)` | Supplier filter plus each sort. |
| `UNIQUE (supplier_key, part_number_key)` (from 7.1) | Supplier filter with the part number sort, and the supplier list, if the planner uses it for those (WS-B to confirm). |
| GIN `part_number_key gin_trgm_ops` | Substring search. |

The hard case is a short or common search term that matches a large share of rows, combined with a sort.
The planner has to choose between collecting the trigram matches and sorting them, and walking a sort index while filtering.
WS-B has to benchmark this case explicitly.

Benchmark matrix: {no search, selective search, unselective search} x {no supplier, large supplier, small supplier} x {each sort column} x {asc, desc} x {first page, deep page}.

### 7.4 API contract

The API uses JSON under `/api`, served by Next.js Route Handlers (D15).
Each handler validates its input with the Zod schemas from `src/contracts/` and calls a plain function in `src/server/`, so the logic can be tested without HTTP.
Money is sent as decimal strings such as `"12.50"` (NFR4).
Errors return `400`, `404`, `409`, or `413` with `{ "error": "message" }`.

**`POST /api/imports`**

- **Request body:** the CSV compressed with gzip, sent as the raw body with `Content-Type: application/gzip`.
  The browser compresses it with the built-in `CompressionStream("gzip")`.
- **`202`:** the body was received and the import has started.
  Returns the same body as `GET /api/imports/latest`.
- **`409`:** an import is already running.
- **`400`:** the body isn't valid gzip.
- **`413`:** the body is over 100 MB.

**`GET /api/imports/latest`**

The status of the most recent import since the server started.
`status` is one of `idle`, `running`, `succeeded`, or `failed`.
`summary` is set once the import succeeds, and `error` once it fails.

```json
{
  "status": "succeeded",
  "startedAt": "2026-10-10T22:00:00Z",
  "finishedAt": "2026-10-10T22:01:10Z",
  "summary": {
    "rowsRead": 1200000,
    "duplicatesCollapsed": 15000,
    "rejected": { "price is not a number": 120 },
    "inserted": 1000,
    "updated": 25000,
    "unchanged": 1158000,
    "markedUnavailable": 300,
    "madeAvailable": 12,
    "durationMs": 70000
  },
  "error": null
}
```

**`GET /api/parts`**

| Param | Values | Default |
| --- | --- | --- |
| `q` | Partial part number. | None |
| `supplier` | A supplier name from `/api/suppliers`, matched after normalization. | None |
| `sort` | `part_number`, `quantity`, `price`, `lead_time` | `part_number` |
| `dir` | `asc`, `desc` | `asc` |
| `limit` | 1 to 200 | 50 |
| `cursor` | Opaque string from a previous response. | None |

```json
{
  "items": [
    {
      "id": 42,
      "partNumber": "AB-1234",
      "supplier": "Acme Supply",
      "quantity": 120,
      "price": "12.50",
      "leadTimeDays": 14,
      "lastUpdated": "2026-10-09T22:14:00Z",
      "unavailableSince": null
    }
  ],
  "nextCursor": "opaque-string-or-null"
}
```

To go back a page, the client keeps a stack of cursors it has already used.

**`GET /api/suppliers`**

Sorted by name.

```json
{ "items": ["Acme Supply", "Globex Parts"] }
```

**`POST /api/quotes`**

```json
{
  "customerName": "Initech",
  "lines": [{ "partId": 42, "quantity": 10, "unitPrice": "12.50" }]
}
```

Returns `201` with the same body as `GET /api/quotes/:id`.
Returns `400` for validation errors, including unknown, repeated, or unavailable parts.
The quote and its lines are inserted in one transaction.

**`GET /api/quotes`**

```json
{
  "items": [
    { "id": 1, "customerName": "Initech", "createdAt": "2026-10-10T15:02:00Z", "lineCount": 1, "total": "125.00" }
  ]
}
```

Newest first, with no pagination (A12).

**`GET /api/quotes/:id`**

```json
{
  "id": 1,
  "customerName": "Initech",
  "createdAt": "2026-10-10T15:02:00Z",
  "lines": [
    {
      "partId": 42,
      "partNumber": "AB-1234",
      "supplier": "Acme Supply",
      "quantity": 10,
      "unitPrice": "12.50",
      "lineTotal": "125.00"
    }
  ],
  "total": "125.00"
}
```

Returns `404` if the quote doesn't exist.

**`GET /api/health`**

Returns `200` with `{ "ok": true }` when the app can reach the database.

### 7.5 UI

The UI only needs to be functional and clear.

- **Import panel:** a file picker and an "Import" button that compresses and uploads the file, then polls `GET /api/imports/latest` every few seconds.
  It shows a running state, then the summary or the error, and refreshes the parts table on success.
  The button is disabled while an import is running.
- **Parts page:** a search box, a supplier dropdown, sortable part number, quantity, price, and lead time headers, previous and next buttons, a checkbox on each row, and a "Selected (N)" panel with a "Create quote" button.
- **Unavailable parts:** shown dimmed, with a "No longer available" label so availability isn't shown by color alone, and with their checkbox disabled.
- **Quote form:** a customer name field and one line per selected part, with editable quantity and unit price (prefilled from the part's price), live totals, and a Save button.
- **Quotes:** a list page and a detail page.
- The selection stores each selected part's data on the client, keyed by part id, so it survives paging and the quote form can prefill unit prices without fetching them again.

## 8. Facts, assumptions, and open questions

### Confirmed by the interviewer (2026-10-10)

- **C1.** Each nightly `parts_export.csv` is a full snapshot of the catalog.
- **C2.** A part is uniquely identified by its supplier and part number together.
- **C3.** When the file repeats a part, the row with the newest last-updated timestamp wins, wherever it sits in the file.
- **C4.** The import must be safe to re-run on the same file or after a crash part-way, and the newest import is the source of truth.
- **C5.** There is one buyer, so no security, authentication, or separate accounts.
- **C6.** A quote line's unit price defaults from the file and can be edited.
- **C7.** Creating a quote never changes catalog data.
- **C8.** The UI is open-ended and less important than the import, table, and quote requirements.
- **C9.** The schema and routes are open, but every choice needs a justification, and the schema should stay as simple as possible.
- **C10.** Part numbers that differ only in extra spaces or punctuation are the same part number.
- **C11.** A part that was in the catalog but is missing from the newest file is kept and marked as no longer available, for example because the supplier stopped carrying it.
- **C12.** Part numbers that differ only in letter case are the same part number.

### Assumptions

**Status** says how each assumption was reached:

- **Judgment call:** a deliberate product decision we made without asking the interviewer.
  These must be stated up front in the presentation.
- **Open:** our best guess, and it could still be confirmed with the interviewer.
- **Retired:** replaced by a confirmed fact.

| ID  | Assumption | Why it matters | Status | Linked question |
| --- | --- | --- | --- | --- |
| A1  | Replaced by C11. | - | Retired | Q2 |
| A2  | Importing an older file after a newer one overwrites the newer data, because the latest run wins. | Decides whether the merge compares timestamps across imports. | Open | Q4 |
| A3  | Replaced by C12. | - | Retired | Q11 |
| A4  | When duplicates share a timestamp, the later row in the file wins. | Keeps the import deterministic. | Open | Q3 |
| A5  | The selection persists across pages and searches, like a cart. | Affects the UI state design. | Open | - |
| A6  | A quote's quantity may be more than the stock on hand. | Affects validation. | Open | Q7 |
| A7  | Quotes can't be changed after they are saved. | Keeps the quote model to insert and read only. | Open | - |
| A8  | The buyer imports by uploading the CSV in the app, so the MVP works end to end from the browser. A CLI calls the same code for development and tests. | Decides the import entry point, and brings in Cloudflare's upload limits (D10). | Judgment call | Q10 |
| A9  | "Partial part number" means a substring match on the normalized part number. | Decides the search index. | Open | Q5 |
| A10 | The supplier filter selects one supplier at a time. | Affects the query and indexes. | Open | Q6 |
| A11 | All prices use one currency. | Affects storage and display. | Open | Q8 |
| A12 | The quote list doesn't need pagination, since there is one buyer and few quotes. | Keeps the API small. | Open | - |
| A13 | Supplier names that differ only in spaces, punctuation, or letter case are the same supplier, displayed with the spelling from that supplier's newest row. | Supplier is part of a part's identity, so treating variants as different suppliers would split one part into several rows. | Judgment call | Q12 |
| A14 | Unavailable parts still appear in the table and search results, dimmed and labeled, but can't be quoted. | The buyer can still tell a customer a part is no longer carried, without quoting it by mistake. | Judgment call | Q13 |
| A15 | A part that reappears in a later file becomes available again. | Affects the merge. | Open | - |

### Open questions

- **Q1.** Resolved by C2 and C10.
- **Q2.** Resolved by C11.
- **Q3.** If duplicate rows have the same last-updated timestamp, which one wins?
- **Q4.** If an older file is imported after a newer one, should it overwrite the newer data, or should the newest timestamp per row still win?
- **Q5.** Does "partial part number" mean a prefix or a match anywhere in the part number?
- **Q6.** Should the supplier filter allow one supplier or several at once?
- **Q7.** Can a quote ask for more than the stock on hand?
- **Q8.** What currency and units are used for price and lead time?
- **Q9.** What latency do buyers expect from "fast"?
- **Q10.** Not asked. Decided by judgment call A8.
- **Q11.** Resolved by C12.
- **Q12.** Not asked. Decided by judgment call A13.
- **Q13.** Not asked. Decided by judgment call A14.
- **Q14.** Should the import refuse to run when a file would mark an unusually large share of the catalog unavailable, for example a truncated export?
  Deferred until after the MVP.

## 9. Decision log

| #   | Decision | Alternatives considered | Rationale and trade-off | Status |
| --- | --- | --- | --- | --- |
| D1  | Use Postgres as the datastore. | None | Required by the brief. | Accepted |
| D2  | Give `parts` a surrogate `bigint` id, with `UNIQUE (supplier_key, part_number_key)` as the natural key. | A composite natural primary key. | v0.2 used part number as a natural key, and that was reversed when identity became supplier plus part number. A two-column text key would be repeated as the tiebreaker in every sort index, in every quote line, in the API, and in every cursor. An id is a small, stable handle, and it stays stable because rows are never deleted (D14). The unique constraint still enforces "no duplicates" and drives the `MERGE`. The cost is one extra column and index. | Proposed |
| D3  | Run the whole import in one transaction: staging table, deduplicate, then one `MERGE` that inserts, updates, and marks parts unavailable. | `INSERT ... ON CONFLICT` plus a separate `UPDATE` for missing parts; batched commits with resume checkpoints; truncate and reload; load a new table and swap it in. | This is also the simplest option, because it needs no extra code. A crash rolls everything back, so re-running is the same as running fresh, with no resume logic (C4). Postgres MVCC means the buyer keeps seeing the previous snapshot until commit, never a half-updated catalog (R1.7). `MERGE ... WHEN NOT MATCHED BY SOURCE` covers all three outcomes in one statement, and it doesn't use up an id for every row the way `ON CONFLICT` does. Unlike `ON CONFLICT`, `MERGE` doesn't guard against concurrent inserts, which is fine because the import is the only process that writes to `parts` and the advisory lock prevents two imports at once. The costs are requiring Postgres 17 or later and a long transaction that holds row locks on changed parts until it commits. | Proposed |
| D4  | Normalize field types in application code; deduplicate and merge in SQL. | Do everything in SQL by `COPY`ing raw text. | A pure normalizer can be unit tested rule by rule and can give a specific reason for each rejected row. SQL handles the set operations without holding the whole file in memory. | Proposed |
| D5  | Only write rows whose values or availability changed. | Overwrite every row on every import. | Re-running the same file writes nothing, the counts are accurate, and fewer dead rows are left for vacuum. | Proposed |
| D6  | Keyset (cursor) pagination. | `OFFSET`/`LIMIT`. | Stays fast at any depth, while `OFFSET` gets slower the deeper you go. The cost is no "jump to page N". | Proposed |
| D7  | Show no exact total count, only whether a next page exists. | Exact `COUNT(*)`; a planner estimate; a capped count. | An exact count over a large filtered result is slow. The buyer is looking for a few matching parts, not a total. Can be revisited if the interviewer wants totals. | Proposed |
| D8  | Store the supplier as text on `parts`, with a generated `supplier_key`, and write the spelling from the supplier's newest row onto all of its parts. | A separate `suppliers` table (proposed in v0.4); keep each part's own spelling. | Keeps the schema to one catalog table and the import to one `MERGE`. Writing the newest spelling onto every row means the table and the dropdown always agree. The costs are repeating the supplier name on every row, rewriting a supplier's rows when its newest spelling changes, unavailable parts keeping an older spelling, and a supplier list query that scans `parts`. | Proposed |
| D9  | A quote line stores the part id, quantity, and unit price. | Copy the supplier and part number onto each line too. | Copying the unit price is enough for R3.5. A part's supplier and part number keys never change for its id, so joining for them is safe. | Proposed |
| D10 | Import by uploading the gzip-compressed CSV to `POST /api/imports`, which responds `202` and runs the import in the background inside the web process. A CLI calls the same function. | CLI only (v0.5); split the file by hand into two uploads; DNS-only Cloudflare to avoid the cap; upload straight to object storage; chunked uploads; run the import inside the request; a separate worker service with pg-boss. | The buyer has to be able to import from the app (A8). Cloudflare Access (D17) needs Cloudflare's proxy, which caps request bodies at 100 MB and expects a response within 100 seconds. Compressing in the browser takes the 126 MB file to about 36 MB with one built-in API and no new infrastructure, and the snapshot stays whole, which C11 depends on. Responding `202` before importing avoids the timeout. Splitting by hand risks importing half a snapshot and marking the other half unavailable. DNS-only loses Cloudflare Access. Object storage and chunking work at any size but add infrastructure or a protocol we don't need at 36 MB. A worker with pg-boss is the better long-term home and is in the backlog (section 12). The costs are that a restart mid-import loses the status (the catalog is safe, because the transaction rolls back) and the buyer has to upload again, and that the cap comes back if the compressed file ever nears 100 MB. | Proposed |
| D11 | Money is `numeric` in Postgres and a decimal string in JSON. | Floats; integer cents. | Exact values without unit conversions in every layer. | Proposed |
| D12 | Stack: Next.js 16 (App Router) with TypeScript (`strict`, `noUncheckedIndexedAccess`) and pnpm; Drizzle ORM 0.45 with `pg` and `pg-copy-streams`; Zod 4; `csv-parse`; Tailwind CSS 4, shadcn/ui, and TanStack Table; Vitest with Testcontainers; Postgres 17; Railway hosting behind Cloudflare. | See `docs/tech-stack-research.md`. | One TypeScript codebase for the UI, API, and importer, with SQL-first data access for the bulk import and Zod at every boundary where untrusted data enters. | Accepted |
| D13 | Define key normalization once, as a SQL function used by the generated key columns, import deduplication, search, and the supplier filter. | Normalize in the importer, and separately in the API; separate rules for part numbers and supplier names. | One definition means "the same part", "the same supplier", and "what search matches" can't drift apart. A normalized search term also can't contain `LIKE` wildcards. Part numbers and supplier names share one rule because C10, C12, and A13 define "the same" identically. The cost is that changing the rule needs a migration that rewrites the key columns. | Proposed |
| D14 | Mark missing parts with an `unavailable_since` timestamp. | Delete them; an `available` boolean. | C11 asks us to record that a part is no longer available, not to remove it. Deleting would also break quotes that reference the part. A timestamp costs the same as a boolean and also records when the part went away. | Proposed |
| D15 | Serve a JSON API under `/api` with Route Handlers, which call plain functions in `src/server/`. | Server Components that query the database directly, with Server Actions for writes. | The interviewer asked for routes with a justified design (C9). An explicit API lets the UI workstream build against mocks in parallel. Since the UI matters least (C8), every requirement can also be demonstrated with plain HTTP requests. Keeping the logic in plain functions means it can be tested without HTTP. The cost is client-side data fetching for the table and one more layer than Server Components would need. | Accepted |
| D16 | Each workstream writes Vitest tests for its own code against Postgres 17 in Testcontainers. Playwright browser tests are deferred. | Defer all tests; a shared Docker Compose test database; an in-memory fake Postgres. | Tests are how parallel agents prove their "done when" lists without waiting for each other, so they add no serial time. Testcontainers gives every test run its own database, so agents in separate worktrees can't clobber each other's data or ports. `COPY`, `MERGE`, and trigram search need a real Postgres. The costs are needing Docker and a few seconds of startup per test run. | Accepted |
| D17 | Put the deployed site behind Cloudflare Access. | Build a login into the app; a public URL; DNS-only Cloudflare. | C5 means no auth in the app, but a public URL would let anyone import files or create quotes. Access adds a login at the edge with no app code. It needs Cloudflare's proxy, which brings the upload limits that D10 works around. | Accepted |

## 10. Work breakdown

```
T0.1 Profile data --+
                    +--> T0.3 Freeze contracts --+--> WS-A Importer -------+
T0.2 Scaffold ------+                            +--> WS-B Parts query ----+
      |                                          +--> WS-C Quotes API -----+--> T2 Integrate, E2E, README
      |                                          +--> WS-D Web UI ---------+
      +--> WS-E Deploy (lowest priority, never blocks anything else) ------+
```

### Rules for parallel work

- Each workstream only edits paths it owns (table below), so merges don't conflict.
- Each workstream runs in its own branch or worktree and merges on its own.
- Each workstream proves its "done when" items with Vitest tests or scripts, not by inspection (D16).
- T0.2 installs every dependency in D12 up front, so Phase 1 workstreams shouldn't need to touch `package.json` or `pnpm-lock.yaml`.
  If one must add a dependency, it says so in its PR, because lockfile changes conflict.
- T0.3 writes `src/db/schema.ts`, including the initial indexes from 7.3, and generates all the initial migrations.
  In Phase 1, only WS-B may change the schema or generate migrations, and only for indexes, because drizzle-kit's migration journal conflicts when two branches add migrations.

| Path | Owner |
| --- | --- |
| `src/db/`, `drizzle/` | T0.3; WS-B for index changes only |
| `src/contracts/` (Zod schemas and types for the API and the clean row) | T0.3 |
| `tests/fixtures/` | T0.3 |
| `src/server/importer/`, `src/app/api/imports/`, `scripts/import.ts` | WS-A |
| `src/server/parts/`, `src/app/api/parts/`, `src/app/api/suppliers/`, `scripts/bench/` | WS-B |
| `src/server/quotes/`, `src/app/api/quotes/` | WS-C |
| Everything else under `src/app/`, and `src/components/` | WS-D |
| Railway config, `docs/deploy.md` | WS-E |

### Phase 0: foundations (blocking)

**T0.1 Profile the data** - can run alongside T0.2

- **Input:** a generated `parts_export.csv`, 100k rows first and then the full file.
- **Tools:** DuckDB, which runs SQL straight against the CSV.
- **Output:** `docs/data-profile.md`, listing every column with its target type, every data problem found with counts and examples, the normalize-or-reject rule for each problem, and the distributions WS-B needs.
- **Done when:** every column has a type and a rule, and sections 6 and 7.1 of this doc are updated to match.
- **Constraint:** don't read the generator source (section 6).

**T0.2 Scaffold** - can run alongside T0.1

- **Output:**
  - A Next.js 16 app per D12, built with `output: "standalone"`, with lint and formatting set up and Tailwind and shadcn/ui initialized.
  - Every D12 dependency installed.
  - Drizzle configured with `pg`, and `pnpm db:generate` and `pnpm db:migrate` scripts, with no domain tables yet.
  - Docker Compose running `postgres:17` for local development.
  - Vitest wired to Postgres 17 in Testcontainers, with one example test that runs a query.
  - `GET /api/health` from 7.4.
  - An app shell with navigation to placeholder Parts and Quotes pages.
  - A stub `pnpm import <file>` script.
- **Done when:** from a fresh clone, the README's commands bring up Postgres and the app, and `pnpm lint`, `pnpm test`, and `pnpm build` all pass.
- **Out of scope:** domain tables, API routes other than health, and any feature UI, since those belong to T0.3 and Phase 1.

**T0.3 Freeze contracts** - after T0.1 and T0.2

- **Output:**
  - `src/db/schema.ts` and its migrations, finalized from the data profile: the hand-written migration for `pg_trgm` and `normalize_key`, the tables from 7.1, and the initial indexes from 7.3.
  - Zod schemas in `src/contracts/` for every request and response in 7.4, plus the clean row type between the normalizer and the loader, with TypeScript types inferred from them.
  - Two small CSV fixtures packed with the data traps, a "night 1" and a "night 2", with the database state each should produce, for WS-A.
    Night 2 drops, changes, adds, and re-adds parts, and both nights spell some part numbers and supplier names differently.
  - JSON response fixtures, for WS-D's mocks.
- **Done when:** the migrations apply, the types compile, the fixtures are committed, and section 7 is marked frozen.

### Phase 1: parallel workstreams

**WS-A Importer** (R1, NFR2)

- **Owns:** `src/server/importer/`, `src/app/api/imports/`, and `scripts/import.ts`.
- **Reads:** sections 4 (R1), 6, 7.1, 7.2, and 7.4, and `docs/data-profile.md`.
- **Can split across two agents:** A1 builds the row normalizer and its unit tests, and A2 builds the loader (staging, deduplication, supplier spelling, `MERGE`, summary), the import routes, and the CLI.
  The two meet at the clean row type from T0.3.
- **Done when:**
  - Unit tests cover every rule in `docs/data-profile.md`.
  - Importing the night 1 fixture, then the night 2 fixture, produces exactly the expected database state after each.
  - Part number variants that differ only in spaces, punctuation, or case collapse into one part, and the newest timestamp wins.
  - Supplier name variants collapse into one supplier, and all of its parts in the file show the spelling from its newest row.
  - Parts missing from night 2 are marked unavailable, and parts that come back are available again.
  - A second import of the same file reports nothing inserted, updated, or newly unavailable, and a checksum over `parts` doesn't change.
  - Killing the process mid-import leaves the database unchanged, and re-running it produces the same state as an uninterrupted run.
  - Uploading a gzipped fixture to `POST /api/imports` returns `202`, and `GET /api/imports/latest` then reports the summary.
  - A second upload while one is running returns `409`.
  - The full 1.2M-row file, gzipped and uploaded, finishes importing, and the time is recorded in section 11.
- **Out of scope:** import history tables, the worker service, and truncated-export protection (section 12).

**WS-B Parts query** (R2, NFR1)

- **Owns:** `src/server/parts/`, `src/app/api/parts/`, `src/app/api/suppliers/`, `scripts/bench/`, and index changes in `src/db/` and `drizzle/`.
- **Reads:** sections 4 (R2), 7.1, 7.3, and 7.4, plus the distributions in `docs/data-profile.md`.
- **Doesn't wait on WS-A:** it seeds 1.2M synthetic parts with `generate_series`, shaped like the real data, then re-runs the benchmark on real data in Phase 2.
- **Delivers:** `GET /api/parts`, `GET /api/suppliers`, any index changes, and a benchmark script that runs the 7.3 matrix and the supplier list with `EXPLAIN ANALYZE`.
- **Done when:**
  - Integration tests prove that paging over every sort and direction never repeats or skips a row, including across tied and missing values.
  - Integration tests prove that search and the supplier filter ignore spaces, punctuation, and case, and that `%` and `_` in a search term never act as wildcards.
  - Integration tests prove that unavailable parts are returned with their `unavailableSince` value.
  - Every benchmark combination and the supplier list meet NFR1, and the results table is in section 11.

**WS-C Quotes API** (R3 server side)

- **Owns:** `src/server/quotes/` and `src/app/api/quotes/`.
- **Reads:** sections 4 (R3), 7.1, and 7.4.
- **Delivers:** `POST /api/quotes`, `GET /api/quotes`, and `GET /api/quotes/:id`.
- **Done when:**
  - Integration tests cover every validation rule in R3.2, each returning `400`, including unavailable parts.
  - A failed line insert leaves no quote behind.
  - A checksum over `parts` is unchanged after creating a quote (R3.4).
  - Changing a part's price, or marking it unavailable, after a quote is saved leaves the quote unchanged (R3.5).

**WS-D Web UI** (R1.8, R2, and R3 user-facing)

- **Owns:** everything under `src/app/` except `src/app/api/`, and `src/components/`.
- **Reads:** sections 2, 7.4, and 7.5.
- **Builds against** the Zod contracts and the JSON fixtures from T0.3, mocking the API until WS-A, WS-B, and WS-C land.
- **Done when:** against the mocks, the buyer can upload a file and see the import summary, search, filter, sort, page, select across pages, create a quote, and see it in the list and detail pages.
  Loading, empty, and error states are handled, and unavailable parts are dimmed, labeled, and not selectable.
- **Out of scope:** visual polish beyond clean and usable, and Playwright tests (section 12).

**WS-E Deploy** (G5, lowest priority)

- **Starts after:** T0.2 only, since it needs an app to deploy.
  It runs alongside everything else and never blocks another workstream.
- **Owns:** the Railway config file and `docs/deploy.md`.
- **Mostly manual:** account and dashboard steps in Railway and Cloudflare are done by hand.
  An agent can write the config and a step-by-step checklist.
- **Delivers:**
  - A Railway project with the `web` service (the standalone Next.js build) and Postgres 17, connected over Railway's private network.
  - Migrations run as Railway's pre-deploy step.
  - A subdomain as a proxied (orange cloud) CNAME, with SSL/TLS mode set to Full (strict).
  - A Cloudflare Access application that only lets in allowed email addresses (D17).
- **Done when:** the subdomain shows the Access login and then the app, `GET /api/health` returns `ok`, and, once Phase 2 is done, uploading the full export through the deployed site finishes an import.

### Phase 2: integration

- **T2.1** Replace the mocks with the real API, upload the full 1.2M-row file through the app, re-run the WS-B benchmark on real data, and walk through the whole buyer flow end to end in a browser.
  Repeat the upload and walkthrough on the deployed site if WS-E is done.
- **T2.2** Write the README (setup, import, run, summary of design decisions, and the judgment calls from section 8) and finish the presentation notes.

**If time runs short:** WS-A and WS-B first, then WS-C, then WS-D, then WS-E (C8, G5).

## 11. Results and presentation notes

### Measurements

- **File size:** 126 MB raw, about 36 MB gzipped at the default level (section 6).
- **Import:** TBD (WS-A).
- **Query benchmark:** TBD (WS-B).

### Talking points

- **Judgment calls made without asking the interviewer:** A8 (import from the app), A13 (supplier name variants are the same supplier, shown under the newest spelling), and A14 (unavailable parts stay visible but can't be quoted).
  State these up front, with the reasoning.
- **Crash safety for free:** one transaction (D3) is the simplest import design and also the one that makes re-running after a crash safe and keeps the buyer from ever seeing a half-applied import.
- **Working within Cloudflare's limits:** compressing in the browser and responding `202` (D10) instead of splitting the file, dropping Cloudflare Access, or adding object storage and a job queue.
- **A decision that changed when the requirements did:** D2 moved from a natural key to a surrogate id when identity became supplier plus part number.
- **Simplicity over normalization:** D8 considered a `suppliers` table and kept a text column instead, accepting a few display edge cases for a simpler schema and import.
- **Known risk deferred past the MVP:** working out "no longer available" from a full snapshot means a truncated or partial export would wrongly mark many parts unavailable (Q14).

## 12. Post-MVP backlog

Features we would like but deliberately left out of the MVP, with what would make each one worth doing.

| Item | What it adds | Worth doing when |
| --- | --- | --- |
| Worker service with pg-boss | Moves the import out of the web process, so deploys and restarts don't interrupt it, and keeps job status in Postgres so it survives restarts. Adds retries and scheduling. BullMQ on Redis is the next step after that (see `docs/tech-stack-research.md`). | An import is lost to a restart or deploy, imports start to slow down browsing, or imports should run on a schedule. |
| Upload straight to object storage | A presigned multipart upload to a Railway Bucket or Cloudflare R2 removes the 100 MB cap entirely. | The gzipped export approaches 100 MB, which is roughly a raw file of 300 MB or more. |
| Truncated-export guard (Q14) | Refuses an import that would mark an unusually large share of the catalog unavailable. | Before relying on real nightly files, since one bad export would hide a large part of the catalog. |
| Playwright end-to-end tests | Browser tests for upload, search, and quoting. | The UI stabilizes, or regressions in the browser flow start slipping through. |
| Import history | A table of past imports and their rejected rows, for auditing. | The buyer needs to answer "what changed last night" or audit rejected rows. |

## Appendix A. Original brief

Lightly cleaned up from the interviewer's spoken brief.

> A distributor we work with gets a nightly export of every part its suppliers carry, about 1.2 million rows, from a legacy ERP.
> Buyers look up stock, price, and lead time while quoting customers.
> Today they open the file in Excel, and Excel gives up.
>
> Build a small web app backed by Postgres that:
>
> 1. **Imports the export.** Tomorrow's file will overlap today's, so running the import again must be safe.
> 2. **Shows the parts in a table.** Server-side pagination, sorting by quantity, price, or lead time in either direction, search by partial part number, and a supplier filter.
>    Any combination should stay fast at this size.
> 3. **Lets a buyer create a quote.** Select rows and create a quote with a customer name plus line items with quantity and unit price.
>    The quote is saved and can be viewed afterwards.
>
> The tech stack is completely open.
