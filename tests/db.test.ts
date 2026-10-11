import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { createTestDb } from "./db";

const db = await createTestDb();

test("tests run against Postgres 17, the version Railway provides", async () => {
  const { rows } = await db.execute<{ server_version_num: string }>(sql`SHOW server_version_num`);
  expect(rows[0]?.server_version_num).toMatch(/^17\d{4}$/);
});
