import { describe, expect, test, vi } from "vitest";
import { ErrorResponse } from "@/contracts/common";
import { PartsResponse } from "@/contracts/parts";
import { parts } from "@/db/schema";
import { createTestDb } from "../../../../tests/db";

const db = await createTestDb();
vi.doMock("@/db", () => ({ db }));
const { GET } = await import("./route");

await db.insert(parts).values(
  ["AB-1", "AB-2", "AB-3"].map((partNumber, i) => ({
    supplier: "Allied Fastener Supply",
    partNumber,
    quantity: i,
    lastUpdated: new Date("2026-09-01T00:00:00Z"),
  })),
);

const get = (search: string) => GET(new Request(`http://localhost/api/parts${search}`));

describe("GET /api/parts", () => {
  test("returns a page and a cursor that leads to the next one", async () => {
    const first = await get("?sort=quantity&dir=desc&limit=2&supplier=allied%20fastener%20supply");
    expect(first.status).toBe(200);
    const page = PartsResponse.parse(await first.json());
    expect(page.items.map((item) => item.partNumber)).toEqual(["AB-3", "AB-2"]);

    const cursor = encodeURIComponent(page.nextCursor ?? "");
    const second = PartsResponse.parse(
      await (await get(`?sort=quantity&dir=desc&limit=2&cursor=${cursor}`)).json(),
    );
    expect(second).toMatchObject({ items: [{ partNumber: "AB-1" }], nextCursor: null });
  });

  test.each([
    ["a limit out of range", "?limit=0", "limit: Limit must be between 1 and 200"],
    ["an unknown sort", "?sort=name", "sort: "],
    ["an empty supplier", "?supplier=", "supplier.0: Supplier can't be empty"],
    ["a malformed cursor", "?cursor=not-a-cursor", "cursor: "],
  ])("answers 400 for %s", async (_, search, message) => {
    const response = await get(search);
    expect(response.status).toBe(400);
    expect(ErrorResponse.parse(await response.json()).error).toContain(message);
  });

  test("answers 400 for a cursor from another sort", async () => {
    const page = PartsResponse.parse(await (await get("?sort=quantity&limit=1")).json());
    const response = await get(`?sort=price&cursor=${encodeURIComponent(page.nextCursor ?? "")}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "cursor: The cursor is for a different sort or direction",
    });
  });
});
