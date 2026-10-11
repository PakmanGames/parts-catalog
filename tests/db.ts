import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, inject } from "vitest";
import type { Db } from "@/db";
import * as schema from "@/db/schema";

/**
 * Gives the calling test file its own freshly migrated database, dropped after the file's tests.
 *
 * Cloning the template from tests/global-setup.ts takes milliseconds, so test files run in parallel
 * without seeing each other's rows, and no test has to clean up after itself.
 * Call it once at the top level of a test file.
 */
export async function createTestDb(): Promise<Db> {
  const templateUrl = new URL(inject("templateDatabaseUrl"));
  const template = templateUrl.pathname.slice(1);
  const name = `test_${randomUUID().replaceAll("-", "")}`;

  // CREATE and DROP DATABASE can't run while connected to the target or the template, so they go
  // through the built-in `postgres` maintenance database.
  const admin = new Pool({
    connectionString: withDatabase(templateUrl, "postgres"),
    max: 1,
  });
  await admin.query(`CREATE DATABASE ${name} TEMPLATE ${template}`);

  const pool = new Pool({ connectionString: withDatabase(templateUrl, name) });
  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE ${name}`);
    await admin.end();
  });

  return drizzle(pool, { schema });
}

function withDatabase(url: URL, database: string): string {
  const copy = new URL(url);
  copy.pathname = `/${database}`;
  return copy.href;
}
