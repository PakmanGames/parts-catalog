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

`.env` holds the local `DATABASE_URL`.
To override it, put your value in `.env.local`, which Git ignores.

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
| `pnpm db:generate` | Generates a migration in `drizzle/` from `src/db/schema.ts`. |
| `pnpm db:migrate` | Applies pending migrations to `DATABASE_URL`. |
| `pnpm import:csv <file>` | Imports a parts export from the command line. |

To start over with an empty local database, run `docker compose down --volumes` and then `pnpm dev`.
Do the same if the database container exits with "Error: in 18+, these Docker images are configured to store database data in a format...".
That means the volume holds data from an older Postgres version, which Postgres 18 can't open.

## Tests

`pnpm test` needs Docker but not the dev database.
Each run starts its own Postgres container with Testcontainers and migrates it once.
A test file that needs the database calls `createTestDb()` from `tests/db.ts` to get its own copy, so files run in parallel without sharing rows.
