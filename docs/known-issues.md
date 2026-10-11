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

### K2. Every worktree shares one local dev database (Low)

`compose.yaml` names the project `parts-catalog`, so all worktrees and branches use the same Postgres container and volume.
Migrations, imports, and quotes from one branch show up in every other branch's dev server.
Tests are not affected, because each test run starts its own container.

- **Workaround:** `docker compose down --volumes`, then `pnpm dev`, to start from an empty database.
- **Fix if it becomes a problem:** give each worktree its own `COMPOSE_PROJECT_NAME` and host port, with a matching `DATABASE_URL` in `.env.local`.

### K3. `pnpm dev` fails if something else is using port 5432 (Low)

A local Postgres, such as one installed with Homebrew, makes `docker compose up` fail with "port is already allocated".

- **Workaround:** stop the other Postgres, or change the host port in `compose.yaml` and set the matching `DATABASE_URL` in `.env.local`.

### K4. The standalone build doesn't copy `public/` (Low)

`pnpm build` copies `.next/static` into `.next/standalone`, because the standalone server doesn't do it itself.
There is no `public/` folder yet, so the build doesn't copy one.
If WS-D adds `public/`, the production server will return 404 for those files.

- **Fix:** when adding `public/`, append `&& cp -r public .next/standalone/` to the `build` script.

### K5. The Postgres image tag is pinned in two places (Low)

`compose.yaml` and `tests/global-setup.ts` both pin `postgres:17.11`, and nothing checks that they match.
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
