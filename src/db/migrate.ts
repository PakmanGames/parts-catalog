/**
 * Applies pending migrations from ./drizzle. Run it with `pnpm db:migrate`.
 *
 * This uses drizzle-orm's runtime migrator rather than `drizzle-kit migrate`, so it needs only
 * production dependencies and works as Railway's pre-deploy command (docs/deploy.md).
 * Node runs this file directly, without a bundler, so it must not use the `@/` alias or
 * extensionless imports.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
} finally {
  await pool.end();
}
