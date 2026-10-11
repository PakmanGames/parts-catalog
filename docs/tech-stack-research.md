# Tech Stack Research

Status: stack accepted (PRD D12).
Last updated: 2026-10-10.
Versions and platform limits were checked on that date and will drift.

## Goal

Pick a stack for the Mock A take-home: import a messy nightly parts export into a catalog that a buyer can search, filter, and quote from.
The priority is a working MVP under a tight time limit, so this doc favors the fewest moving parts.
Notes on what would change at larger scale are collected in [Beyond the MVP](#beyond-the-mvp).

The starting preference is Next.js with TypeScript, schema validation, Postgres, Railway (Hobby plan), and a domain on Cloudflare.
Alternatives are included only where they solve a concrete problem for this project.
Product requirements, the schema, and the import design live in [`PRD.md`](PRD.md); this doc covers technology choices only.
Where the two disagree, the PRD wins.

## The data

The input is `mock_a/parts_export.csv`: about 1.2M rows and 126 MB, described by the generator as a messy export.
1.2M rows is small for Postgres, but too big to hold in a browser or a Cloudflare Worker, or to parse inside a single web request.

For the MVP, the browser gzips the file before uploading it, which takes it to about 36 MB, well under Cloudflare's 100 MB request limit.
See [Getting the file into the system](#getting-the-file-into-the-system).

## Recommendation at a glance

| Layer | MVP choice | Why |
|---|---|---|
| App framework | Next.js 16 (App Router) + TypeScript | Your preference, and one codebase for UI and API |
| Schema validation | Zod 4, alongside Drizzle for the database schema | Zod checks untrusted input at runtime; Drizzle defines the tables |
| Database | Postgres 18 on Railway | Set-based cleaning in SQL, fast bulk loads, `MERGE` for re-imports, substring search via `pg_trgm` |
| Data access | Drizzle ORM + `pg` (node-postgres) | SQL-first and easy to mix with raw SQL for bulk loads |
| Upload | The browser gzips the whole CSV and posts it to a Route Handler | 126 MB becomes about 36 MB, under Cloudflare's 100 MB cap, with no manual split or object storage |
| Bulk ingestion | Streaming `csv-parse` + `COPY` into a temporary staging table, then one `MERGE`, all in one transaction | Flat memory use, fast loads, and crash safety for free; see [much larger files](#much-larger-files) |
| Background work | In the web process for the MVP: the upload route responds `202` and imports in the background | No extra service; a worker with pg-boss is in the PRD's post-MVP backlog |
| Hosting | Railway (web + Postgres) behind a proxied Cloudflare subdomain with Cloudflare Access | One platform, a private network to the database, and a login with no app code |
| UI | Tailwind CSS 4 + shadcn/ui + TanStack Table | Fast to build, with server-side paging for large tables |
| Testing | Vitest + Testcontainers in the MVP; Playwright deferred | Parallel workstreams prove their work against a real Postgres; see [Testing](#testing) |

The sections below explain each choice and what was considered instead.

## Next.js 16 and TypeScript

Next.js 16.4 with React 19.3 is current.
Use the App Router, with Route Handlers under `/api` for all data access (PRD D15).
Build with `output: "standalone"` so the app runs as a plain Node server on Railway.

Next.js should not run long work inside a request.
For the MVP, the upload route responds `202` and runs the import in the background in the same process, for example with `after()`, and the UI polls for its status.
A separate worker process is the post-MVP home for this work; see [Background work](#background-work).

Turn on TypeScript `strict` and `noUncheckedIndexedAccess`.
The second flag catches many row-parsing mistakes at compile time, because indexing into an array or record returns `T | undefined`.

Use pnpm for packages, and Biome or ESLint + Prettier for linting and formatting.
Next.js 16 no longer ships `next lint`, so either way it's a separate tool.

## Schema validation: Zod 4

Zod 4 (4.6) is the recommendation.

- It validates every boundary where untrusted data enters: CSV rows, upload requests, form input, and environment variables.
- `drizzle-zod` (0.8, supports Zod 4) derives Zod schemas from Drizzle tables, so writes to the catalog are checked against the table's shape without defining it twice.
- React Hook Form has a Zod resolver.
- Zod 4 parses objects several times faster than Zod 3, which matters when validating 1.2M rows.

### Zod and Drizzle are not alternatives

They solve different problems, and this stack uses both.

| | Drizzle | Zod |
|---|---|---|
| What it is | An ORM: table definitions, migrations, and typed queries | A runtime validation library |
| What it describes | The shape of the database | The shape of data entering the app |
| Checks data at runtime? | No; it gives compile-time types, and the database enforces its own constraints on write | Yes; it parses unknown input and returns typed data or a list of errors |
| Used here for | Staging, catalog, and error tables; migrations; queries | Raw CSV rows, upload requests, forms, environment variables |

Drizzle's TypeScript types only describe what the code promises to pass in.
They can't tell whether a CSV cell actually contains a valid price or date, because that data only exists at runtime.
Zod does that check, and its output then flows into Drizzle with types that match the table.

The raw CSV row schema should be written by hand in Zod, because it describes messy input, not the clean table.
The schema for writing to the catalog can be generated from the Drizzle table with `drizzle-zod`.

Considered:

- **Valibot** (1.5): smaller browser bundles, but bundle size barely matters for an internal tool, and it has fewer integrations.
- **ArkType** (2.2): very fast, but its syntax is less familiar and its ecosystem is smaller.

All three implement Standard Schema, so switching later would be cheap.

## Database: Postgres

Postgres fits this project well.

- Set-based SQL (`INSERT ... SELECT`, `DISTINCT ON`, window functions) is the cleanest way to normalize and deduplicate a million rows.
- `COPY` loads a million rows in seconds.
- `pg_trgm` indexes make substring search on part numbers fast.
- `MERGE ... WHEN NOT MATCHED BY SOURCE` (Postgres 17+) inserts new parts, updates changed ones, and marks missing ones unavailable in one statement, which makes re-imports idempotent.

Railway Hobby allows Postgres volumes up to 5 GB.
That is plenty: the parts file is 126 MB as CSV, and even with indexes and the temporary staging copy during an import, the database should stay in the low single-digit GB at most.

For local development, run Postgres in Docker with the same major version Railway uses, which is 18.
The `postgres:18` image keeps its data in `/var/lib/postgresql/18/docker`, so mount the data volume at `/var/lib/postgresql`.
Mounting it at `/var/lib/postgresql/data`, as older versions did, makes the container exit with an error.

### Data access: Drizzle ORM

Drizzle (stable 0.45, with drizzle-kit 0.31 for migrations) is the recommendation.

- Schemas are plain TypeScript, with no code generation step.
- The query builder stays close to SQL, and raw SQL through the `sql` template is a first-class escape hatch.
  This project will need that for `COPY`, staging tables, and trigram queries.
- Drizzle can define generated columns and GIN indexes with operator classes.
  `CREATE EXTENSION`, the `normalize_key` SQL function, and `MERGE` can't be expressed in it, so they go in a hand-written migration or raw SQL.
- `drizzle-zod` derives Zod schemas from tables.

Risk: Drizzle 1.0 has been in beta for a long time.
Pin to 0.45.x and don't adopt the beta mid-project.

Considered:

- **Prisma** (7.x stable, 8 in release candidate): mature, with excellent migrations and Prisma Studio.
  But it has its own schema language and a generate step, and the bulk-load work would be raw SQL anyway.
- **Kysely**: an excellent type-safe query builder, but it has no schema definition or migration generation, so more plumbing is hand-written.

Driver: `pg` (node-postgres 8.23) with `pg-copy-streams` for `COPY ... FROM STDIN`.
`postgres` (postgres.js) is an equally good driver with built-in `COPY` support.
Pick one and use it everywhere.

## Ingestion pipeline

The full design is in PRD section 7.2.
In short:

1. Stream the upload through gunzip and `csv-parse` (7.x), so memory use stays flat regardless of file size.
   `csv-parse` can also skip and report malformed rows, such as a wrong column count or broken quoting.
   Feeding the file straight to `COPY` instead would abort the whole load on the first malformed row.
2. Normalize each row in TypeScript with a hand-written Zod schema, which returns either a clean row or a rejection reason.
3. In one transaction, `COPY` the clean rows into a temporary staging table, deduplicate with `DISTINCT ON`, and `MERGE` into the catalog.
4. Show the import summary in the app: rows read, rows rejected by reason, duplicates collapsed, and parts inserted, updated, and marked unavailable.

One transaction is simpler than committing in batches, and it gives two things for free.
A crash rolls everything back, so re-running is always safe.
The buyer never sees a half-applied import, because Postgres keeps serving the previous snapshot until the commit.

The staging table is temporary, not permanent.
Changing a cleaning rule means re-running the import from the file, which is cheap at this size, instead of keeping raw rows and an errors table around.

**DuckDB** (the `duckdb` CLI or `@duckdb/node-api`) is worth having locally to profile the file before writing rules.
It can run SQL directly against the CSV without loading it anywhere.
It's a development tool here, not part of the deployed stack.

Python with pandas or Polars would also handle this well, and the generator is already Python.
It isn't recommended because it splits the codebase across two languages with no capability gain at this size.

### Getting the file into the system

For the MVP, the browser compresses the file and uploads it to a Route Handler in one request.

- Compress with the built-in `CompressionStream("gzip")`.
  On the generated file, gzip takes 126 MB down to about 36 MB at the default level (45 MB at the fastest).
  That is well under the 100 MB request body cap on Cloudflare's Free and Pro plans, so the subdomain can stay proxied and behind Cloudflare Access.
- Send the compressed file as the raw request body with `Content-Type: application/gzip`, not as multipart form data, so the handler doesn't have to parse a form.
- Use a Route Handler, not a Server Action: Server Actions cap request bodies at 1 MB by default.
- Keep the upload route out of the `proxy.ts` matcher (Next.js 16's new name for middleware).
  When proxy runs, Next.js buffers the request body in memory and keeps only the first 10 MB by default.
- Respond `202` as soon as the body has arrived, and run the import in the background.
  Cloudflare returns a 524 error if the origin takes more than 100 seconds to respond, and a full import could get close to that.

Splitting the file into halves was considered and rejected.
Each file is a full snapshot, and parts missing from it are marked unavailable, so importing only one half would wrongly hide the other half of the catalog.

The cap comes back if the compressed file ever nears 100 MB.
Uploading straight to object storage removes it; see [File uploads](#file-uploads).

## Background work

For the MVP, the import runs in the background inside the web process, as described above.
That is enough for one buyer and one import a night, and it adds no services.
The cost is that a restart or deploy during an import loses it, although the transaction leaves the catalog unchanged and the buyer can upload again.

A separate worker is in the PRD's post-MVP backlog, for when imports need to survive restarts and deploys.
When that happens, this is the plan.

A second Railway service that runs the same codebase with a different entry point (for example `tsx src/worker.ts`) and has no public domain.
Railway's Next.js guide uses the same layout.

To hand jobs from the web app to the worker:

- **pg-boss** (12.x) is the first choice.
  It stores jobs in Postgres, so it adds no new infrastructure, and it supports retries, scheduling, and singleton jobs.
- **BullMQ + Redis** is the scale-up path.
  See [Background jobs on Redis](#background-jobs-on-redis).
- **Graphile Worker** is a similar Postgres-based option.
  It's fast, but still pre-1.0.
- **Hosted services (Inngest, Trigger.dev)** have good developer experience, but add another vendor and account to a take-home.

Keep each job's logic in plain functions, called from a thin pg-boss handler.
Moving to BullMQ later then only changes the wiring, not the job code.

## Hosting

### Option A: everything on Railway (recommended)

One Railway project with these services:

- `web`: Next.js (standalone build), public, on a custom subdomain.
- `postgres`: Railway Postgres 18, reached over the private network (`*.railway.internal`), so there's no egress cost and no public database endpoint.
- `worker` (post-MVP): the same repo with the worker entry point, and no public domain.

Cloudflare's role is DNS: a CNAME for the subdomain (for example `parts.<your-domain>`) pointing at the Railway domain.

The subdomain is proxied, because Cloudflare Access needs it (PRD D17):

- **Proxied (orange cloud), chosen:** adds Cloudflare's CDN and WAF, and lets you put Cloudflare Access (a Zero Trust login) in front of the site with no auth code.
  The 100 MB request body cap and the 100-second response timeout apply, which the gzipped upload and the `202` response stay within.
  The subdomain's SSL/TLS mode must be Full, not Flexible, which loops redirects.
  Full (strict) doesn't work either, because Railway can't get its own certificate behind Cloudflare Access (PRD D19).
- **DNS only (grey cloud), rejected:** the simplest setup, with no upload size cap from Cloudflare, but no Cloudflare Access, so anyone with the URL could use the app.

Why this option: one platform and one deploy pipeline, the app and database share a private network and region, and there are no runtime limits beyond a normal Node server.
Hobby allows up to 48 vCPU and 48 GB of RAM per service, far more than this needs.

Rough cost: the Hobby plan is $5/month, and that $5 is a usage credit.
Railway bills RAM at $10/GB-month and CPU at $20/vCPU-month, by the minute.
Two small, mostly idle services (web and Postgres) should land around the $5 credit, or slightly above it once the worker is added.
Check the usage dashboard after the first week.

### Option B: Next.js on Cloudflare Workers, backend on Railway

Deploy Next.js to Workers with the OpenNext adapter (`@opennextjs/cloudflare` 1.20, which supports Next.js 16).
Connect to Railway Postgres through Hyperdrive, which pools connections and caches queries.

Pros: global edge delivery, static assets served from Cloudflare, and everything under your existing Cloudflare account.

Cons for this project:

- Workers get 128 MB of memory, so the import pipeline has to run elsewhere anyway.
- The Workers Free plan allows 10 ms of CPU time per request, too little for server rendering in practice.
  Realistically this needs Workers Paid ($5/month) on top of Railway.
- The gzipped Worker bundle is capped at 3 MiB (Free) or 10 MiB (Paid), which needs watching as dependencies grow.
- Per the OpenNext docs, Node middleware is not yet supported.
- Every page still queries Postgres in Railway's region, so edge rendering mostly adds a hop instead of removing one.
- Two platforms and two deploy pipelines, plus a split between edge and Node runtime code.

Verdict: Option B pays off for a public, global, read-heavy site.
This is a data-heavy internal tool with one database, so the costs outweigh the benefits.

### Option C: Vercel

Vercel is the native Next.js host and has the smoothest developer experience.
It isn't recommended: it adds a third platform, the database would still be on Railway, and long-running ingestion doesn't fit serverless functions.

### Database hosting alternatives

Neon or Supabase would also work.
Railway Postgres is simpler, because you already pay for the plan and it shares a private network with the app.
Railway supports scheduled volume backups (daily, weekly, monthly).
Confirm they're available on Hobby before relying on them, or add a `pg_dump` cron service.

## UI

- **Tailwind CSS 4 + shadcn/ui**, so components live in the repo as source code you own.
- **TanStack Table** for the catalog and import views, with paging, sorting, and filtering done in SQL.
  Never send 1.2M rows to the browser.
- **React Hook Form + Zod** for forms, posting to the `/api` routes and reusing the same Zod schemas (PRD D15).

## Testing

Vitest and Testcontainers are in the MVP (PRD D16), because the parallel workstreams prove their work with tests.
Only Playwright is deferred.

- **Vitest** (5.x) for unit and integration tests.
  The cleaning and normalization rules are the highest-value tests in this project, so build table-driven tests from real messy rows.
- **Testcontainers** (`@testcontainers/postgresql`) for integration tests against a real Postgres 18.
  `COPY`, `MERGE`, and trigram queries can't be tested against an in-memory fake.
  Each test run gets its own database container, so agents working in separate worktrees don't collide on data or ports.
- **Playwright** (post-MVP) for the end-to-end flow: upload the file, wait for the import, and check the summary.

## Beyond the MVP

These choices are deliberately left out of the MVP.
Each one notes when it becomes worth doing.

### Much larger files

The MVP pipeline is fine at 1.2M rows.
At billions of rows (hundreds of GB of CSV), these parts stop scaling:

- **Load speed:** one parser feeding one `COPY` stream runs on a single core, so load time grows from seconds to hours.
  Split the file into chunks and load them in parallel `COPY` streams, into an `UNLOGGED` staging table, creating indexes only after the load.
- **Upload:** no single request can carry the file.
  Upload to object storage with multipart uploads and process it from there (see [File uploads](#file-uploads)).
- **Storage:** Railway Hobby's 5 GB volume can't hold it.
  The database needs a larger plan or a managed Postgres sized for it, with tables partitioned by import so old imports can be dropped cheaply.
- **Cleaning:** set-based SQL over billions of rows in one pass is slow and hard to recover from if it fails.
  Process in chunks (per partition), or do the heavy transformation in a columnar engine (DuckDB on one machine, a warehouse or Spark across many) and load only the clean result into Postgres.

### File uploads

When the gzipped file nears Cloudflare's 100 MB cap, replace the single upload request with a presigned upload straight from the browser to object storage (a Railway Bucket or Cloudflare R2), using multipart uploads for large files.
The file then never passes through Cloudflare's proxy or the Next.js server, so the 100 MB cap stops mattering.
This is the pattern Railway's own Next.js guide uses.
Both stores are S3-compatible, so `@aws-sdk/client-s3` works with either.

### Background jobs on Redis

pg-boss is enough for a handful of imports.
As job volume and job types grow, BullMQ on Redis (6.x) is the stronger long-term choice:

- It sustains much higher job throughput, and queue traffic stops competing with catalog queries for Postgres.
- It has built-in rate limiting, priorities, and parent/child job flows.
- It has mature monitoring dashboards, such as Bull Board.

The cost is one more service to run, pay for, and back up.
Switch when queue load shows up in Postgres metrics, or when jobs need features pg-boss lacks.
Railway's Next.js guide already uses this setup, so the migration path is well documented.

## Versions checked

Latest published versions on npm as of 2026-10-10.

| Package | Version |
|---|---|
| `next` | 16.4.0 |
| `react` | 19.3.0 |
| `zod` | 4.6.5 |
| `drizzle-orm` / `drizzle-kit` | 0.45.4 / 0.31.11 (1.0 in beta) |
| `drizzle-zod` | 0.8.3 |
| `prisma` | 8.0.0-rc.22 (7.x is the stable line) |
| `pg` / `pg-copy-streams` | 8.23.1 / 7.0.0 |
| `csv-parse` | 7.0.3 |
| `pg-boss` | 12.37.1 |
| `bullmq` | 6.3.12 |
| `@opennextjs/cloudflare` | 1.20.10 |
| `tailwindcss` | 4.3.3 |
| `vitest` | 5.0.3 |
| `@playwright/test` | 1.64.0 |
| `@testcontainers/postgresql` | 12.2.0 |

## Sources

- [Railway plans and pricing](https://docs.railway.com/pricing/plans)
- [Railway pricing](https://docs.railway.com/pricing)
- [Railway backups](https://docs.railway.com/reference/backups)
- [Railway: full-stack Next.js with Postgres, background jobs, and file uploads](https://docs.railway.com/guides/fullstack-nextjs)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits)
- [OpenNext for Cloudflare](https://opennext.js.org/cloudflare)
- [Next.js: `serverActions.bodySizeLimit`](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions)
- [Next.js: `proxyClientMaxBodySize`](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize)
- [Drizzle vs Prisma in 2026 (MakerKit)](https://makerkit.dev/blog/tutorials/drizzle-vs-prisma)
