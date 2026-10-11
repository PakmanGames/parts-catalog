/**
 * Vitest global setup: starts one Postgres container per test run and migrates a template database
 * in it. Each test file then clones the template with `createTestDb()` (tests/db.ts).
 *
 * Testcontainers gives every run its own server on a random port, so agents testing in separate
 * worktrees never share data or collide on ports (PRD D16).
 */
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    /** Connection URL of the migrated template database. */
    templateDatabaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  // Keep this tag in sync with compose.yaml.
  const container = await new PostgreSqlContainer("postgres:17.11")
    .withDatabase("migrated")
    .start();

  const pool = new Pool({ connectionString: container.getConnectionUri() });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  } finally {
    // Postgres refuses to clone a template while anything is connected to it.
    await pool.end();
  }

  project.provide("templateDatabaseUrl", container.getConnectionUri());
  return async () => {
    await container.stop();
  };
}
