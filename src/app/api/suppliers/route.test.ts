import { expect, test, vi } from "vitest";
import { SuppliersResponse } from "@/contracts/suppliers";
import { parts } from "@/db/schema";
import { createTestDb } from "../../../../tests/db";

const db = await createTestDb();
vi.doMock("@/db", () => ({ db }));
const { GET } = await import("./route");

test("GET /api/suppliers returns the supplier names", async () => {
  await db.insert(parts).values([
    { supplier: "Mesa Gear Works", partNumber: "AB-1", lastUpdated: new Date("2026-09-01") },
    { supplier: "Allied Fastener Supply", partNumber: "AB-1", lastUpdated: new Date("2026-09-01") },
  ]);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(SuppliersResponse.parse(await response.json())).toEqual({
    items: ["Allied Fastener Supply", "Mesa Gear Works"],
  });
});
