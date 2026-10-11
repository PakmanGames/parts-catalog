# API response fixtures

Response bodies for WS-D to mock the API with until WS-A, WS-B, and WS-C land (PRD T0.3).
Each one matches its schema in `src/contracts/`, which `tests/fixtures/fixtures.test.ts` checks.

The data is the catalog after importing `night-1.csv` and then `night-2.csv` from [`../imports`](../imports/README.md), so it includes parts that are no longer available and parts with an unknown quantity, price, or lead time.
Ids follow insertion order, and the import ran at `2026-10-11T02:00:05.000Z`.

| File | Endpoint | Status |
| --- | --- | ---: |
| `parts-page-1.json` | `GET /api/parts?limit=8`, sorted by part number | 200 |
| `parts-page-2.json` | `GET /api/parts?limit=8&cursor=mock-cursor-page-2`, the last page | 200 |
| `parts-empty.json` | `GET /api/parts?q=...` with no matches | 200 |
| `suppliers.json` | `GET /api/suppliers` | 200 |
| `import-idle.json` | `GET /api/imports/latest` before any import | 200 |
| `import-running.json` | `POST /api/imports`, then `GET /api/imports/latest` while it runs | 202, 200 |
| `import-succeeded.json` | `GET /api/imports/latest` after night 2 succeeded | 200 |
| `import-failed.json` | `GET /api/imports/latest` after a failed import | 200 |
| `quotes.json` | `GET /api/quotes`, newest first | 200 |
| `quote.json` | `GET /api/quotes/1` | 200 |
| `quote-created.json` | `POST /api/quotes`, with a unit price the buyer edited | 201 |
| `health.json` | `GET /api/health` | 200 |
| `error-400.json` | Any request that fails validation | 400 |
| `error-404.json` | `GET /api/quotes/99` | 404 |
| `error-409.json` | `POST /api/imports` while an import runs | 409 |
| `error-413.json` | `POST /api/imports` with a body over 100 MB | 413 |
| `error-503.json` | `GET /api/health` with the database down | 503 |
