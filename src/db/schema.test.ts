import { sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { createTestDb } from "../../tests/db";
import { parts, quoteLines, quotes } from "./schema";

// The migrations from drizzle/ have already run on this database (tests/global-setup.ts).
const db = await createTestDb();

const lastUpdated = new Date("2026-09-30T00:00:00Z");

/** Resolves to the Postgres error code a query fails with, such as `23505` for a unique violation. */
async function errorCode(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (error) {
    // Drizzle wraps the driver's error, which carries the SQLSTATE code.
    return (error as { cause?: { code?: string } }).cause?.code;
  }
  return undefined;
}

describe("normalize_key", () => {
  test.each([
    ["ab 123", "AB123"],
    ["AB-123-X", "AB123X"],
    ["NAS1149-500R", "NAS1149500R"],
    ["d38999/24jg62sc", "D3899924JG62SC"],
    ["  Allied  Fastener Supply.", "ALLIEDFASTENERSUPPLY"],
    ["Delta Wire & Cable", "DELTAWIRECABLE"],
    ["%_", ""],
  ])("normalizes %j to %j", async (raw, key) => {
    const { rows } = await db.execute<{ key: string }>(sql`SELECT normalize_key(${raw}) AS key`);
    expect(rows[0]?.key).toBe(key);
  });

  test("returns NULL for NULL", async () => {
    const { rows } = await db.execute<{ key: string | null }>(
      sql`SELECT normalize_key(NULL) AS key`,
    );
    expect(rows[0]?.key).toBeNull();
  });
});

describe("parts", () => {
  test("derives both keys from the display spellings", async () => {
    const [row] = await db
      .insert(parts)
      .values({ supplier: "Allied Fastener Supply", partNumber: "MS21045L176", lastUpdated })
      .returning();
    expect(row).toMatchObject({
      supplierKey: "ALLIEDFASTENERSUPPLY",
      partNumberKey: "MS21045L176",
      unavailableSince: null,
    });
  });

  test("never holds two rows for spelling variants of the same part (R1.3)", async () => {
    await db
      .insert(parts)
      .values({ supplier: "Anchor Fluid Power", partNumber: "AN6C35", lastUpdated });
    const variant = db
      .insert(parts)
      .values({ supplier: "ANCHOR  FLUID POWER.", partNumber: "an6-c35", lastUpdated });
    expect(await errorCode(variant)).toBe("23505");
  });

  test("lets different suppliers carry the same part number", async () => {
    await db.insert(parts).values([
      { supplier: "Apex Machined Parts", partNumber: "NAS620986P", lastUpdated },
      { supplier: "Bay Aero Components", partNumber: "NAS620986P", lastUpdated },
    ]);
  });

  test("keeps an unknown quantity, price, and lead time as NULL (A19)", async () => {
    const [row] = await db
      .insert(parts)
      .values({ supplier: "Blue Ridge Bearings", partNumber: "MS28775-218", lastUpdated })
      .returning();
    expect(row).toMatchObject({ quantity: null, price: null, leadTimeDays: null });
  });

  test("stores prices exactly, as numeric(12, 2) strings (NFR4)", async () => {
    const [row] = await db
      .insert(parts)
      .values({
        supplier: "Coastal Avionics Supply",
        partNumber: "M83248/2-390",
        price: "18.1",
        lastUpdated,
      })
      .returning();
    expect(row?.price).toBe("18.10");
  });

  test("has the initial index plan from PRD 7.3", async () => {
    const { rows } = await db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'parts'`,
    );
    const definitions = rows.map(({ indexdef }) => indexdef.replace(/^.* USING /, ""));
    expect(definitions.sort()).toEqual([
      "btree (id)",
      "btree (lead_time_days, id)",
      "btree (part_number_key, id)",
      "btree (price, id)",
      "btree (quantity, id)",
      "btree (supplier_key, lead_time_days, id)",
      "btree (supplier_key, part_number_key)",
      "btree (supplier_key, price, id)",
      "btree (supplier_key, quantity, id)",
      "gin (part_number_key gin_trgm_ops)",
    ]);
  });
});

describe("quotes", () => {
  test("rejects a blank customer name", async () => {
    expect(await errorCode(db.insert(quotes).values({ customerName: "   " }))).toBe("23514");
  });

  test("rejects a line with a non-positive quantity, a negative price, or an unknown part", async () => {
    const [part] = await db
      .insert(parts)
      .values({ supplier: "Delta Wire & Cable", partNumber: "M22759/16-22-9", lastUpdated })
      .returning();
    const [quote] = await db.insert(quotes).values({ customerName: "Initech" }).returning();
    if (!part || !quote) throw new Error("setup failed");

    const line = { quoteId: quote.id, partId: part.id, quantity: 1, unitPrice: "1.00" };
    expect(await errorCode(db.insert(quoteLines).values({ ...line, quantity: 0 }))).toBe("23514");
    expect(await errorCode(db.insert(quoteLines).values({ ...line, unitPrice: "-0.01" }))).toBe(
      "23514",
    );
    expect(await errorCode(db.insert(quoteLines).values({ ...line, partId: part.id + 1000 }))).toBe(
      "23503",
    );
    await db.insert(quoteLines).values(line);
  });
});
