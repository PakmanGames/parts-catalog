# Parts Catalog Mock A

A take-home project for interview practice.
Requirements, design, and the build plan are in [`docs/PRD.md`](docs/PRD.md).

## Prerequisites

- Node.js 24
- pnpm 12 (`corepack enable` picks up the version pinned in `package.json`)
- Docker, running

## Getting started

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts Postgres 18 in Docker, applies migrations, and serves the app at <http://localhost:3000>.
`GET /api/health` returns `{ "ok": true }` once the app can reach the database.

`.env` holds the local defaults.
To override any of them, put your values in `.env.local`, which Git ignores and which takes precedence over `.env`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Starts Postgres, migrates it, and runs the Next.js dev server. |
| `pnpm build` | Builds the standalone production server into `.next/standalone`. |
| `pnpm start` | Runs the standalone server built by `pnpm build`. |
| `pnpm lint` | Checks linting and formatting with Biome. |
| `pnpm format` | Fixes formatting, import order, and safe lint issues. |
| `pnpm typecheck` | Generates Next.js route types and runs `tsc`. |
| `pnpm test` | Runs Vitest against a throwaway Postgres 18 container. |
| `pnpm compose <args>` | Runs `docker compose <args>` for this worktree's database, reading `.env.local` too. |
| `pnpm db:generate` | Generates a migration in `drizzle/` from `src/db/schema.ts`. |
| `pnpm db:migrate` | Applies pending migrations to `DATABASE_URL`. |
| `pnpm import:csv <file>` | Imports a parts export from the command line. |

Use `pnpm compose` instead of plain `docker compose`, which ignores `.env.local` and so can act on another worktree's database.
To start over with an empty local database, run `pnpm compose down --volumes` and then `pnpm dev`.
Do the same if the database container exits with "Error: in 18+, these Docker images are configured to store database data in a format...".
That means the volume holds data from an older Postgres version, which Postgres 18 can't open.

## Running several worktrees at once

By default every worktree shares one database container on port 5432, so data from one branch shows up in the others.
To give a worktree its own database, create a `.env.local` in it with a project name and port that no other worktree uses:

```sh
COMPOSE_PROJECT_NAME=parts-catalog-ws-b
DB_PORT=5433
DATABASE_URL=postgres://parts:parts@localhost:5433/parts_catalog
```

`DB_PORT` and the port in `DATABASE_URL` must match.
`pnpm dev`, `pnpm compose`, `pnpm db:migrate`, `pnpm import:csv`, and the Next.js server all read `.env.local`, so they all use that worktree's database.
If port 3000 is taken, `next dev` moves to the next free port and prints it.

This is also the fix if something else, such as a Homebrew Postgres, already uses port 5432.

## Tests

`pnpm test` needs Docker but not the dev database.
Each run starts its own Postgres container with Testcontainers and migrates it once.
A test file that needs the database calls `createTestDb()` from `tests/db.ts` to get its own copy, so files run in parallel without sharing rows.
