# Known Issues

> **Last updated:** 2026-10-10

Errors and likely bugs found while building, kept here so they don't get lost between workstreams.
Each issue has a `K#` ID that is never reused, like the IDs in [`PRD.md`](PRD.md).
When an issue is fixed, move it to [Resolved](#resolved) with a note on the fix, instead of deleting it.

Severity:

- **High:** breaks a requirement or corrupts data.
- **Medium:** can cause wrong behavior in a realistic workflow.
- **Low:** friction, drift risk, or a gap in verification.

## Open

### K1. Drizzle's migrator silently skips migrations generated out of order (Medium)

`pnpm db:migrate` only applies migrations whose timestamp is newer than the last one the database has applied.
If branch A generates a migration, branch B generates a later one, and B merges and migrates first, A's migration is skipped without an error on every database that already ran B's.
The migrator also ignores edits to a migration that has already been applied, and takes no lock, so two concurrent runs could both apply the same migration.

- **Mitigation now:** PRD section 10 lets only WS-B add migrations in Phase 1, so this needs two branches with migrations to happen.
- **If it happens:** regenerate the older migration so it sorts last, and reset local databases with `docker compose down --volumes`.
- **Who should know:** T0.3 and WS-B.

### K2. Every worktree shares one local dev database (Medium)

`compose.yaml` names the project `parts-catalog` and binds host port 5432, so all worktrees and branches use the same Postgres container and volume.
Migrations, imports, and quotes from one branch show up in every other branch's dev server.
Tests are not affected, because each test run starts its own container.

This becomes a real problem in Phase 1, when agents work in parallel worktrees.
WS-B seeds 1.2M synthetic parts for its benchmark into the same `parts` table that WS-A imports the real file into, so each would corrupt the other's data and timings.

- **Fix before Phase 1:** give each worktree its own Compose project and host port.
  - Make the host port configurable in `compose.yaml`: `"${DB_PORT:-5432}:5432"`.
  - Set `COMPOSE_PROJECT_NAME`, `DB_PORT`, and a `DATABASE_URL` with the same port in each worktree's `.env.local`. `COMPOSE_PROJECT_NAME` overrides the `name:` in `compose.yaml`.
  - Compose only reads `.env`, so the `dev` script has to pass `.env.local` to it as well, for example with `--env-file`.
  - `pnpm db:migrate` and `pnpm import:csv` also load only `.env` (`--env-file-if-exists=.env`), so they ignore `.env.local` today and would migrate or import into the default database. They need to load `.env.local` too, with it taking precedence.
  - This also fixes K3.
- **At minimum:** WS-B runs its benchmark in its own Testcontainers database instead of the dev database.
- **Workaround until then:** `docker compose down --volumes`, then `pnpm dev`, to start from an empty database.

### K3. `pnpm dev` fails if something else is using port 5432 (Low)

A local Postgres, such as one installed with Homebrew, makes `docker compose up` fail with "port is already allocated".

- **Workaround:** stop the other Postgres.
  Moving this project's database to another port only works after the K2 fix, because `pnpm db:migrate` ignores a `DATABASE_URL` set in `.env.local`.

### K4. The standalone build doesn't copy `public/` (Low)

`pnpm build` copies `.next/static` into `.next/standalone`, because the standalone server doesn't do it itself.
There is no `public/` folder yet, so the build doesn't copy one.
If WS-D adds `public/`, the production server will return 404 for those files.

- **Fix:** when adding `public/`, append `&& cp -r public .next/standalone/` to the `build` script.

### K5. The Postgres image tag is pinned in two places (Low)

`compose.yaml` and `tests/global-setup.ts` both pin `postgres:18.6`, and nothing checks that they match.
Both files have a comment pointing at the other.

### K6. A missing `DATABASE_URL` in production falls back to localhost (Low)

The committed `.env` sets the local development URL, and the standalone build includes it.
If Railway's `DATABASE_URL` is ever missing, the app connects to `localhost:5432`, and `GET /api/health` returns `503` with `ECONNREFUSED` instead of saying the variable is unset.

- **Fix if needed:** fail at startup in production when `DATABASE_URL` is unset, or validate the environment with Zod.

### K7. `pnpm build` needs network access (Low)

`next/font/google` downloads the Geist fonts at build time, so an offline build fails.
Railway builds have network access, so this only matters for offline local builds.

### K8. Phone-width layout is unverified (Low)

The end-to-end check covered desktop width only, because resizing the browser window had no effect during the check.
The app shell uses a simple padded flex layout, but WS-D should check it on a narrow viewport.

### K9. Some browser extensions cause a hydration warning in development (Low)

The SwiftRead extension adds a `data-swiftread-extension-automation-bridge-ready` attribute to `<html>` before React loads.
React reports this as a hydration mismatch, and the Next.js dev overlay shows "1 Issue".
It isn't caused by app code and doesn't happen without the extension.

- **Options:** ignore it, or add `suppressHydrationWarning` to `<html>` in `src/app/layout.tsx`, which also hides real mismatches on that one element.

### K15. Cache Components can freeze `GET` routes at build time (High)

`next.config.ts` enables `cacheComponents`, so Next.js prerenders a `GET` route handler during the build when the handler reads nothing from the request (K14).
K14 fixed this for `GET /api/health` only.
Three planned routes read nothing from the request, so they would be frozen the same way:

- `GET /api/imports/latest` would always return the status from build time (`idle`), so the import panel would never see an import finish (PRD R1.8).
- `GET /api/quotes` would always return the quote list from build time (PRD R3.3).
- `GET /api/suppliers` would always return the supplier list from build time, or make the build fail when it can't reach the database.

`GET /api/parts` and `GET /api/quotes/:id` read the request, so they stay dynamic.

- **Fix:** turn off `cacheComponents` in `next.config.ts`, and check whether `partialPrefetching` still applies without it.
  The UI fetches all of its data from `/api` in the browser (PRD D15), so Cache Components adds nothing here.
- **Alternative:** keep it, and make every `GET` handler call `await connection()` first, like the health route.
- **When:** before Phase 1, since WS-A, WS-B, and WS-C all add `GET` handlers.
- **Who should know:** T0.3, WS-A, WS-B, and WS-C.

## Resolved

### K10. The PRD's import command ran pnpm's built-in `import` (Resolved in T0.2)

`pnpm import <file>` runs pnpm's lockfile-conversion command, never a `package.json` script named `import`.
The command is now `pnpm import:csv <file>`, and PRD sections 7.2 and T0.2 were updated.

### K11. `shadcn init` left the sans-serif font token pointing at itself (Resolved in T0.2)

The theme in `globals.css` reads `--font-sans`, but the layout defined `--font-geist-sans`, so `--font-sans: var(--font-sans)` resolved to nothing.
The layout now loads Geist into `--font-sans`.
Check for this again if `shadcn init` is ever re-run.

### K12. The health check reported unhelpful database errors (Resolved in T0.2)

Through Drizzle, a failed check read "Failed query: select 1".
A refused connection from `pg` is an `AggregateError` with an empty message and only a code.
The health route now queries through `pg` and falls back to the error code, for example "Database unreachable: ECONNREFUSED".

### K13. `tsc` failed on a clean checkout (Resolved in T0.2)

`LayoutProps` comes from route types that Next.js generates into `.next/`, which a fresh clone doesn't have.
`pnpm typecheck` now runs `next typegen` before `tsc`.

### K14. Cache Components could prerender the health check at build time (Resolved in T0.2)

With Cache Components enabled, a `GET` route handler can be prerendered during the build.
The health route calls `connection()` first, so the build never touches the database and every request is a live check.
