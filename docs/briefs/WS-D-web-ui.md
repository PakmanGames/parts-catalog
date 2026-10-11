# Agent Brief: WS-D Web UI

> **Task:** PRD section 10, WS-D.
> **Starts:** stage 1 now, and stage 2 when T0.3 is on `main`.
> **Read first:** [`phase-1-rules.md`](phase-1-rules.md), especially the decisions.

## Why this matters

This is what the buyer sees.
They upload the nightly export, then find parts across 1.2M rows, then build and save quotes.
The UI only needs to be clean and functional (C8), but it has to be correct.
That means exact money, honest states (loading, empty, error, unknown, unavailable), and nothing that looks broken.

## You own

- Everything under `src/app/`, except `src/app/api/`.
- `src/components/`, `src/lib/`, and `src/hooks/`.
  These are shadcn's folders, and no other workstream uses them.

## Read first

- **`docs/PRD.md`:**
  - who the buyer is: section 2;
  - what to build: R1.8, R2, R3, and 7.5;
  - the API: 7.4;
  - judgment calls: A5, A6, and A14.
- **The decisions in `phase-1-rules.md`:** especially that quantity, price, and lead time can be unknown.
- **Contracts:** every file in `src/contracts/`.
- **`AGENTS.md`,** then the Next.js guides in `node_modules/next/dist/docs/` for the App Router, client components, and environment variables.
- **`docs/known-issues.md`:** K4, K8, and K9.

## Building against APIs that don't exist yet

- **One typed API client** in `src/lib/api/`, with one function per endpoint.
  - Every response is parsed with its Zod contract.
  - Every error shows the `error` message from `ErrorResponse`.
- **A mock mode,** switched on with `NEXT_PUBLIC_API_MOCKS=1` in `.env.local`.
  - It returns contract-valid data after a realistic delay.
  - It covers the error cases too: an import already running (`409`), a failed import, and quote validation errors (`400`).
  - The mocks live in `src/lib/api/mocks/`, and T2.1 deletes them.
- **Where the real routes come from:** WS-A2 builds the import routes, WS-B the parts and suppliers routes, and WS-C the quote routes.

## Stage 1: start now

These use only contracts that are already on `main`.

1. **Import panel** at the top of the Parts page (R1.8, 7.5):
   - It has a file picker and an Import button.
   - It compresses the file in the browser with `CompressionStream("gzip")` into a `Blob`, then `POST`s it with `Content-Type: application/gzip`.
     If the compressed file is over 100 MB, it says so instead of uploading.
   - It polls `GET /api/imports/latest` every few seconds and shows the running state, then the summary or the error.
     The summary shows every count, with rejected rows by reason.
   - The button is disabled while an import runs, and a `409` shows a clear message.
   - On success it refreshes the parts table.
     Leave a clear hook for that until stage 2 builds the table.
2. **Quotes list** at `/quotes`: newest first, showing the customer, created time, line count, and total, with an empty state.
3. **Quote detail** at `/quotes/[id]`: the lines with their totals and the quote total, and a not-found state for a `404`.
4. **Money helpers** in `src/lib/`:
   - They turn decimal strings into whole cents with `BigInt`, multiply and add them, and format the result.
   - Never use JavaScript numbers for money (NFR4).
   - They have unit tests.

Open a PR when stage 1 is done, so it can merge early.

## Stage 2: when T0.3 is on `main`

Start when `origin/main` has the parts contract in `src/contracts/` and the JSON response fixtures.
Base the parts mocks on those fixtures.

5. **Parts table,** using TanStack Table with paging and sorting done on the server:
   - **Columns:** part number, supplier, quantity, price, lead time, and availability.
   - **Search:** a search box, debounced.
   - **Suppliers:** a multi-select filled from `GET /api/suppliers`.
   - **Sorting:** sortable headers for part number, quantity, price, and lead time, in both directions.
   - **Paging:**
     - Previous and Next buttons, using a stack of cursors already seen (7.4).
     - Paging resets when the search, filter, or sort changes.
6. **Unknown values** always show text, never a blank cell: for example "Unknown" for quantity and lead time, and "No price" for price.
7. **Unavailable parts** are dimmed, have a "No longer available" label, and have a disabled checkbox (A14).
8. **Selection:**
   - **Storage:** it is kept on the client, keyed by part id, with each part's data, so it survives paging and new searches (R3.1, 7.5).
   - **Panel:** a "Selected (N)" panel lets the buyer remove parts and start a quote.
9. **Quote form:**
   - **Fields:** a customer name, and one line per selected part with an editable quantity (at least 1) and unit price.
   - **Unit price:** prefilled from the part's price.
     When the price is unknown, it starts empty and is required.
   - **Totals:** line totals and the quote total update as the buyer types.
   - **Stock warnings** (A6):
     - **Quantity above stock:** a warning such as "80 more than in stock, lead time 21 days".
     - **Unknown stock or lead time:** the warning says so, for example "Stock unknown, lead time 21 days".
   - **Save:**
     - It sends `POST /api/quotes`, then opens the new quote's detail page and clears the selection.
     - A `400` shows its message next to the form.

## Quality bar

- **Check it in a real browser.**
  Use `chrome-devtools-axi` at desktop width (1280 px) and phone width (390 px), and take screenshots of every page and state:
  - loading;
  - empty;
  - error;
  - unknown and unavailable parts;
  - long part numbers and supplier names;
  - many selected parts.
- **Be picky.**
  Fix anything that looks off, such as misaligned columns, text that overflows or wraps badly, missing focus rings, or layout that jumps while loading.
- **No console errors or warnings,** apart from K9, which a browser extension causes.
- **Accessibility:**
  - Every control works from the keyboard.
  - Sortable headers set `aria-sort`.
  - Availability is never shown by color alone.
- **Numbers:** right-aligned, with tabular figures.
- **Components:** use shadcn/ui (`base-nova`).
  If adding a component with the shadcn CLI changes `package.json`, say so in the PR.
- **No `public/` folder:** avoid adding one.
  If you need it, tell the user, because K4's fix changes the `build` script in `package.json`, which you don't own.

## Done when

- **Stage 1,** against the mocks:
  - an upload shows the running state, then the summary, and the `409` and failure states work;
  - the quotes list and detail pages work, including the empty and not-found states;
  - the money helpers are tested.
- **Stage 2,** against the mocks, the buyer can:
  - search, filter by one or several suppliers, sort, and page;
  - select parts across pages;
  - create a quote, then see it in the list and detail pages.

  Unknown and unavailable parts and the stock warnings behave as above.
- **Both stages:**
  - screenshots at both widths are in each PR;
  - `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.

## Out of scope

Visual polish beyond clean and usable, Playwright tests (PRD section 12), and connecting to the real API, which T2.1 does.
