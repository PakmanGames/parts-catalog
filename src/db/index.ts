import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// `next dev` re-evaluates server modules on every edit. Keeping the pool on globalThis stops each
// reload from opening another set of connections until Postgres runs out.
const globalForDb = globalThis as typeof globalThis & { pool?: Pool };
globalForDb.pool ??= new Pool({ connectionString: process.env.DATABASE_URL });

/** The app's connection pool, for raw `pg` access such as `COPY` (PRD 7.2). */
export const pool = globalForDb.pool;

export const db = drizzle(pool, { schema });

/** Server functions take a `Db` instead of importing `db`, so tests can pass their own database. */
export type Db = typeof db;
