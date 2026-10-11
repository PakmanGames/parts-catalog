# Phase 1 Rules for Every Workstream

> **Applies to:** WS-A1, WS-A2, WS-B, and WS-D (PRD section 10).
> Read this before your own brief.
> Your brief wins where the two differ.

## Where the project is

- **Done and on `main`:** the scaffold (T0.2), the data profile (T0.1, [`docs/data-profile.md`](../data-profile.md)), the deploy (WS-E), and the first half of T0.3, which froze the contracts for imports, suppliers, quotes, and health in `src/contracts/`.
- **In progress:** the second half of T0.3.
  It adds `src/db/schema.ts` and the migrations, the parts contract, the clean row type, the night 1 and night 2 CSV fixtures with their expected database states, and JSON response fixtures.
  It is done when it is on `origin/main` and PRD section 7 is marked frozen.
- Your brief says whether you can start before T0.3 lands, and what to do if you can't.

## Decisions made after the data profile

These settle the open questions in section 8 of the data profile.
They will be recorded in PRD section 8 under new IDs.
Until they are, this list is the source.
If the PRD and this list ever disagree, stop and ask the user.

1. **Dashes and slashes don't change a part number (OQ1, PRD A16).**
   `NAS1149-500R` and `NAS1149500R` are the same part, as C10 says, even though the data suggests otherwise.
   `normalize_key` stays as it is.
2. **The newest row always wins, and bad values become unknown (OQ2, OQ4).**
   The newest copy of a part is the source of truth, even when some of its values are bad.
   A quantity, price, or lead time that is missing or invalid becomes NULL, meaning unknown, and the row is kept.
   That covers blank, `N/A`, `CALL`, and `TBD` values, negative numbers, values that don't parse, and values too large for the column.
   Only rows that can't be identified or dated are rejected: empty rows, rows with too few columns, repeated headers, rows with no part number or supplier, and rows with no valid last-updated date.
3. **Future dates are accepted (OQ3).**
   A last-updated date after the import is taken as written, so the newest timestamp still wins (C3), and re-running the same file always gives the same result (R1.4).
4. **Display spellings (OQ5).**
   Part numbers are shown trimmed and upper-cased.
   Each supplier is shown under its most common spelling among the accepted rows of the file, after trimming and collapsing runs of spaces, with ties broken by a fixed rule.
   This replaces A13's "spelling from the newest row".
5. **Description and NSN are not stored (OQ6).**
6. **Unknown values sort last, in both directions (R2.2).**
   This applies to quantity, price, and lead time.

## Hard constraints on the data

These come from the practice ground rules in PRD section 6, and they are not negotiable.

1. **Never read `generate_mock_data.py`.**
   Don't open, `cat`, `grep`, or import it.
2. **Never open anything under `mock_data/_answer_keys/`.**
3. **The only data file is the mock A export:**
   `/Users/pakmangames/repos/parts-catalog/mock_data/mock_a/parts_export.csv`.
   `mock_data/` is git-ignored, so worktrees don't have it; use that absolute path.
4. **Never print more than 20 raw lines of it** in one command, and never `cat` it.
5. **Never commit data**, database files, or generated output.

## Setting up your worktree

1. Branch from the latest `main`: `git fetch origin && git switch -c <your-branch> origin/main`.
2. Run `pnpm install`.
3. Give your worktree its own dev database, as in the README section "Running several worktrees at once".
   Use these names and ports, so no two agents collide:

   | Workstream | `COMPOSE_PROJECT_NAME` | `DB_PORT` |
   | --- | --- | --- |
   | WS-A1 | Not needed: A1 never uses the dev database. | - |
   | WS-A2 | `parts-catalog-ws-a2` | `5434` |
   | WS-B | `parts-catalog-ws-b` | `5435` |
   | WS-D | `parts-catalog-ws-d` | `5436` |

   Always use `pnpm compose`, never plain `docker compose`.
4. `pnpm test` doesn't use the dev database: it starts Postgres 18 with Testcontainers, and `createTestDb()` from `tests/db.ts` gives each test file its own database.
5. Read `AGENTS.md`.
   This Next.js version has breaking changes, so read the guide in `node_modules/next/dist/docs/` before writing any Next.js code.

## Ownership

- Only edit the paths your brief lists.
- Never edit `src/contracts/`, `tests/fixtures/`, `package.json`, or `pnpm-lock.yaml`.
  Only WS-B may change `src/db/` or add migrations, and only for indexes (K1).
- If a contract or fixture looks wrong, stop and tell the user instead of changing it, because other workstreams build against it.
- If you must add a dependency, say so in your PR, because lockfile changes conflict.
- If you find a bug or risk outside your paths, put it in your PR description and tell the user, instead of fixing it or adding to `docs/known-issues.md` yourself.

## Quality bar

- Prove every "done when" item with an automated test or a script you ran, never by reading the code (D16).
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass before you open a PR.
  Fix any lint error, test failure, or flaky test you meet in your own paths, even if you didn't cause it.
- Money is never a JavaScript number: decimal strings in JSON and code, `numeric` in Postgres (NFR4).
- Keep it simple (NFR5): no abstractions for one caller, and no options nobody asked for.
- Comments explain why, not what.
  Give each new module and exported function a short JSDoc, and match the style of the code around it.

## Writing docs

- Put each sentence on its own line.
- Use a plain hyphen, never an em dash.

## Hand-off

1. Commit messages use a prefix (`feat`, `fix`, `test`, `docs`, `refactor`, `chore`), the imperative mood, and at most 72 characters.
   Never add a co-author line.
2. Before opening the PR, fetch, rebase onto `origin/main`, and re-run the four checks.
3. Open a PR that lists:
   - what you built;
   - how each "done when" item was verified;
   - any measurements;
   - anything you couldn't settle.
4. Don't merge it.
   Tell the user it's ready, and they will review and merge.
