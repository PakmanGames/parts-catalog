# Known Issues

> **Last updated:** 2026-10-11

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

- **Mitigation now:** T0.3 generated both initial migrations in order on one branch: `0000_extensions_and_normalize_key.sql`, then `0001_catalog_and_quotes.sql`.
  PRD section 10 lets only WS-B add migrations in Phase 1, so this needs two branches with migrations to happen.
- **If it happens:** regenerate the older migration so it sorts last, and reset local databases with `pnpm compose down --volumes`.
- **Who should know:** T0.3 and WS-B.

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

### K16. `pnpm dev` and `pnpm compose` don't work on Windows (Low)

The `compose` script, which `dev` runs, checks for `.env.local` with POSIX shell syntax: `$([ -f .env.local ] && echo --env-file .env.local)`.
pnpm runs scripts with `cmd.exe` on Windows, which can't run that, so both commands fail there.
They work on macOS and Linux, and Railway never runs them.

- **Fix if anyone develops on Windows:** set `shell-emulator=true` for pnpm, or replace the shell check with a small Node script that builds the `docker compose` arguments.

### K17. Changes to `.railway/railway.ts` need a manual apply (Low)

Railway doesn't read `.railway/railway.ts` when it deploys, so merging a change to it changes nothing on Railway until someone runs `railway config apply`.
Until then, the file and Railway can disagree, and the next apply may also include changes nobody reviewed recently.

- **Workaround:** after merging a change to the file, run `railway config plan`, check it, and run `railway config apply` (`docs/deploy.md`).
- **Fix if it becomes a problem:** add Railway's `railwayapp/config` GitHub Action, which plans on pull requests and applies on merge, with an environment-scoped `RAILWAY_TOKEN` secret.

### K18. Railpack warns that it can't detect the pnpm lockfile version (Low)

Railway's builder, Railpack 0.40.1, logs "could not detect pnpm lockfile version" during every build.
Railpack reads the pnpm version from `packageManager` in `package.json` before it looks at the lockfile, so it still installs pnpm 12.10.1, and the build succeeds.
The warning is harmless as long as `packageManager` stays set.

### K19. Descending sorts may not find unknown values where R2.2 wants them (Medium)

T0.3 made quantity and price nullable (A19), so three of the four sort columns can now be `NULL`, and R2.2 says unknown values sort last in both directions.
The initial indexes from PRD 7.3 are plain `(column, id)` B-trees, which keep `NULL` last when read forward but return it first when read backward for a descending sort.
So a query that puts unknown values last on a descending sort can't simply walk those indexes backward.
Checked with 200,000 synthetic parts: `ORDER BY quantity DESC, id DESC` is a backward index-only scan, but `ORDER BY quantity DESC NULLS LAST, id DESC` reads the whole table and sorts it, which would miss NFR1 at 1.2M rows.

- **Fix:** WS-B checks the plans for descending sorts on quantity, price, and lead time, and changes the indexes or the query to suit.
  For example, it could add `DESC NULLS LAST` indexes, or fetch the known values and the unknown ones as two keyset ranges.
- **Who should know:** WS-B.

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

### K14. Cache Components could prerender the health check at build time (Resolved in T0.2, superseded by K15)

With Cache Components enabled, a `GET` route handler can be prerendered during the build.
T0.2 made the health route call `connection()` first.
T0.3 turned Cache Components off (K15), so the health route no longer needs that call and has dropped it.

### K15. Cache Components froze `GET` routes at build time (Resolved in T0.3)

With `cacheComponents` on, Next.js prerendered any `GET` route handler that reads nothing from the request, so its response was fixed at build time.
A probe route shaped like `GET /api/imports/latest`, returning in-memory state, was listed as static (`○`) by `pnpm build`, and the production server returned the build-time value on every request.

- **Fix:** `cacheComponents` is off in `next.config.ts`.
  `partialPrefetching` is off too, because it requires Cache Components, and Next.js refuses to start with one and not the other.
- **Verified:** after the change, the same probe was listed as dynamic (`ƒ`) and returned a new value on each request, and `GET /api/health` stays dynamic without `connection()`.
- **For WS-A, WS-B, and WS-C:** new `GET` handlers need nothing extra to run on every request.
  `pnpm build` should still list every `/api` route as `ƒ`.

### K2. Every worktree shared one local dev database (Resolved in T0.3)

`compose.yaml` fixed the project name and host port, and `pnpm db:migrate` and `pnpm import:csv` ignored `.env.local`, so every worktree used the same Postgres container and volume.

- **Fix:** a worktree can set `COMPOSE_PROJECT_NAME`, `DB_PORT`, and `DATABASE_URL` in `.env.local` (README, "Running several worktrees at once").
  `compose.yaml` publishes `${DB_PORT:-5432}`, `pnpm compose` passes `.env.local` to Docker Compose, `pnpm dev` starts the database through it, and `pnpm db:migrate` and `pnpm import:csv` load `.env.local` after `.env`.
  A variable set in the shell still overrides both files.
- **Verified:** two worktrees ran `pnpm dev` at the same time, each with its own container, volume, and port.
  Each `pnpm db:migrate` created its migrations table in its own database, a table created in one database didn't exist in the other, and nothing listened on port 5432.
  `pnpm compose down --volumes` in each removed only that worktree's container and volume.
- **Remember:** plain `docker compose` doesn't read `.env.local`, so in a worktree with its own database it acts on the default project instead. Use `pnpm compose`.

### K3. `pnpm dev` failed if something else used port 5432 (Resolved in T0.3)

A local Postgres, such as one installed with Homebrew, made `docker compose up` fail with "port is already allocated".

- **Fix:** set `DB_PORT` and a matching `DATABASE_URL` in `.env.local`, as for K2.
