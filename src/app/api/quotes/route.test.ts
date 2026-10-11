/**
 * The quotes API against a real Postgres (PRD WS-C "done when"): validation, quoting beyond stock,
 * atomic saves, and that quotes and the catalog never change each other (R3.4, R3.5).
 */
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { QuoteListResponse, QuoteResponse } from "@/contracts/quotes";
import { parts, quotes } from "@/db/schema";
import { createTestDb } from "../../../../tests/db";

const testDb = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { GET: list, POST } = await import("./route");
const { GET: show } = await import("./[id]/route");
const { createQuote } = await import("@/server/quotes");

const lastUpdated = new Date("2026-09-01T00:00:00Z");
let ids: { stocked: number; noStock: number; unknown: number; unavailable: number };

beforeEach(async () => {
  await testDb.execute(sql`TRUNCATE parts, quote_lines, quotes RESTART IDENTITY`);
  const rows = await testDb
    .insert(parts)
    .values([
      {
        supplier: "Allied Fastener Supply",
        partNumber: "MS21045L176",
        quantity: 120,
        price: "12.50",
        lastUpdated,
      },
      {
        supplier: "Bridgewater Avionics",
        partNumber: "UN16492",
        quantity: 0,
        price: "0.40",
        lastUpdated,
      },
      { supplier: "Bay Aero Components", partNumber: "RNC55H9852FM", lastUpdated },
      {
        supplier: "Anchor Fluid Power",
        partNumber: "6036-2327-65",
        quantity: 46,
        price: "64.73",
        lastUpdated,
        unavailableSince: lastUpdated,
      },
    ])
    .returning({ id: parts.id });
  const [stocked, noStock, unknown, unavailable] = rows.map((row) => row.id);
  if (!stocked || !noStock || !unknown || !unavailable) throw new Error("seeding failed");
  ids = { stocked, noStock, unknown, unavailable };
});

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/quotes", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const get = (id: string) =>
  show(new Request(`http://localhost/api/quotes/${id}`), {
    params: Promise.resolve({ id }),
  } as RouteContext<"/api/quotes/[id]">);
const quoteCount = async () => (await testDb.select().from(quotes)).length;
const catalogChecksum = async () =>
  (
    await testDb.execute<{ md5: string }>(
      sql`SELECT md5(string_agg(p::text, ',' ORDER BY id)) FROM parts p`,
    )
  ).rows[0]?.md5;

describe("POST /api/quotes", () => {
  test("saves a quote and returns it with exact totals, as GET /api/quotes/:id does", async () => {
    const response = await post({
      customerName: "  Initech  ",
      lines: [
        { partId: ids.noStock, quantity: 3, unitPrice: "0.10" },
        { partId: ids.stocked, quantity: 10, unitPrice: "12.50" },
      ],
    });
    expect(response.status).toBe(201);
    const quote = QuoteResponse.parse(await response.json());
    expect(quote).toMatchObject({
      id: 1,
      customerName: "Initech",
      lines: [
        {
          partId: ids.stocked,
          partNumber: "MS21045L176",
          supplier: "Allied Fastener Supply",
          quantity: 10,
          unitPrice: "12.50",
          lineTotal: "125.00",
        },
        // 3 × 0.10 is 0.30000000000000004 in floating point, so this proves Postgres numeric (NFR4).
        {
          partId: ids.noStock,
          partNumber: "UN16492",
          supplier: "Bridgewater Avionics",
          quantity: 3,
          unitPrice: "0.10",
          lineTotal: "0.30",
        },
      ],
      total: "125.30",
    });
    expect(await (await get("1")).json()).toEqual(quote);
  });

  describe("answers 400 for every R3.2 rule, and saves nothing", () => {
    const line = () => ({ partId: ids.stocked, quantity: 1, unitPrice: "12.50" });
    test.each([
      ["a body that isn't JSON", () => "{", "The request body isn't valid JSON."],
      [
        "a missing customer name",
        () => ({ lines: [line()] }),
        "customerName: Invalid input: expected string, received undefined",
      ],
      [
        "a blank customer name",
        () => ({ customerName: "   ", lines: [line()] }),
        "customerName: Customer name is required",
      ],
      [
        "no lines",
        () => ({ customerName: "Initech", lines: [] }),
        "lines: A quote needs at least one line",
      ],
      [
        "a quantity of 0",
        () => ({ customerName: "Initech", lines: [{ ...line(), quantity: 0 }] }),
        "lines.0.quantity: Quantity must be at least 1",
      ],
      [
        "a negative quantity",
        () => ({ customerName: "Initech", lines: [{ ...line(), quantity: -2 }] }),
        "lines.0.quantity: Quantity must be at least 1",
      ],
      [
        "a fractional quantity",
        () => ({ customerName: "Initech", lines: [{ ...line(), quantity: 1.5 }] }),
        "lines.0.quantity: Quantity must be a whole number",
      ],
      [
        "a negative unit price",
        () => ({ customerName: "Initech", lines: [{ ...line(), unitPrice: "-1.00" }] }),
        /^lines\.0\.unitPrice: Must be a non-negative amount/,
      ],
      [
        "a unit price as a number",
        () => ({ customerName: "Initech", lines: [{ ...line(), unitPrice: 12.5 }] }),
        /^lines\.0\.unitPrice: /,
      ],
      [
        "a repeated part",
        () => ({ customerName: "Initech", lines: [line(), { ...line(), quantity: 2 }] }),
        /^lines\.1\.partId: Part \d+ appears on more than one line$/,
      ],
      [
        "an unknown part",
        () => ({ customerName: "Initech", lines: [line(), { ...line(), partId: 999 }] }),
        "Part 999 doesn't exist.",
      ],
      [
        "an unavailable part",
        () => ({ customerName: "Initech", lines: [{ ...line(), partId: ids.unavailable }] }),
        "Part 6036-2327-65 from Anchor Fluid Power is no longer available.",
      ],
    ])("%s", async (_, body, error) => {
      const response = await post(body());
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(error);
      expect(await quoteCount()).toBe(0);
    });
  });

  test("accepts a quantity above stock, including no stock and unknown stock (A6, A19)", async () => {
    const response = await post({
      customerName: "Globex",
      lines: [
        { partId: ids.stocked, quantity: 500, unitPrice: "12.50" },
        { partId: ids.noStock, quantity: 5, unitPrice: "0.40" },
        // An unknown price has no default, so the buyer enters one (A19).
        { partId: ids.unknown, quantity: 7, unitPrice: "42.50" },
      ],
    });
    expect(response.status).toBe(201);
    expect(QuoteResponse.parse(await response.json()).total).toBe("6549.50");
  });

  test("leaves no quote behind when a line insert fails", async () => {
    // Bypasses the contract, so the line reaches the database and breaks its CHECK (quantity > 0).
    const request = {
      customerName: "Initech",
      lines: [
        { partId: ids.stocked, quantity: 1, unitPrice: "12.50" },
        { partId: ids.noStock, quantity: 0, unitPrice: "0.40" },
      ],
    };
    await expect(createQuote(testDb, request)).rejects.toThrow();
    expect(await quoteCount()).toBe(0);
  });

  test("never changes the catalog (R3.4)", async () => {
    const before = await catalogChecksum();
    const response = await post({
      customerName: "Initech",
      lines: [{ partId: ids.stocked, quantity: 500, unitPrice: "1.00" }],
    });
    expect(response.status).toBe(201);
    expect(await catalogChecksum()).toBe(before);
  });
});

describe("saved quotes", () => {
  test("don't change when a quoted part's price changes or it becomes unavailable (R3.5)", async () => {
    const created = await post({
      customerName: "Initech",
      lines: [
        { partId: ids.stocked, quantity: 10, unitPrice: "12.50" },
        { partId: ids.noStock, quantity: 250, unitPrice: "0.40" },
      ],
    });
    const saved = await created.json();
    const listed = await (await list()).json();

    // What a later import does to these parts (PRD 7.2).
    await testDb.execute(
      sql`UPDATE parts SET price = 99.99, quantity = 1 WHERE id = ${ids.stocked}`,
    );
    await testDb.execute(sql`UPDATE parts SET unavailable_since = now() WHERE id = ${ids.noStock}`);

    expect(await (await get(String(saved.id))).json()).toEqual(saved);
    expect(await (await list()).json()).toEqual(listed);
  });

  test("are listed newest first, with their line counts and totals", async () => {
    expect(await (await list()).json()).toEqual({ items: [] });
    await post({
      customerName: "Initech",
      lines: [{ partId: ids.stocked, quantity: 10, unitPrice: "12.50" }],
    });
    await post({
      customerName: "Globex",
      lines: [
        { partId: ids.stocked, quantity: 4, unitPrice: "4.25" },
        { partId: ids.unknown, quantity: 8, unitPrice: "42.50" },
      ],
    });
    const { items } = QuoteListResponse.parse(await (await list()).json());
    expect(
      items.map(({ id, customerName, lineCount, total }) => ({
        id,
        customerName,
        lineCount,
        total,
      })),
    ).toEqual([
      { id: 2, customerName: "Globex", lineCount: 2, total: "357.00" },
      { id: 1, customerName: "Initech", lineCount: 1, total: "125.00" },
    ]);
  });
});

describe("GET /api/quotes/:id", () => {
  test.each(["1", "0", "-1", "abc", "1.5", "042", "9007199254740993"])(
    "answers 404 for %j when no such quote exists",
    async (id) => {
      const response = await get(id);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: `Quote ${id} doesn't exist.` });
    },
  );
});
