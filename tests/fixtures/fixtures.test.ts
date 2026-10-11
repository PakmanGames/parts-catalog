/**
 * Keeps the T0.3 fixtures honest: every API fixture matches its contract, and the import fixtures'
 * expected states are internally consistent, so WS-A and WS-D never build against a broken fixture.
 */
import { readdirSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { ErrorResponse } from "@/contracts/common";
import { HealthResponse } from "@/contracts/health";
import { ImportStatusResponse, ImportSummary } from "@/contracts/imports";
import { PartsResponse } from "@/contracts/parts";
import { QuoteListResponse, QuoteResponse } from "@/contracts/quotes";
import { SuppliersResponse } from "@/contracts/suppliers";
import { createTestDb } from "../db";

// The migrated test database, for checking keys against the real normalize_key.
const db = await createTestDb();

const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const readJson = (path: string): unknown => JSON.parse(read(path).toString("utf8"));

/** Money as integer cents, so totals are checked exactly (NFR4). */
const cents = (money: string) => Math.round(Number(money) * 100);

describe("API fixtures", () => {
  const schemas: Record<string, z.ZodType> = {
    "parts-page-1.json": PartsResponse,
    "parts-page-2.json": PartsResponse,
    "parts-empty.json": PartsResponse,
    "suppliers.json": SuppliersResponse,
    "import-idle.json": ImportStatusResponse,
    "import-running.json": ImportStatusResponse,
    "import-succeeded.json": ImportStatusResponse,
    "import-failed.json": ImportStatusResponse,
    "quotes.json": QuoteListResponse,
    "quote.json": QuoteResponse,
    "quote-created.json": QuoteResponse,
    "health.json": HealthResponse,
    "error-400.json": ErrorResponse,
    "error-404.json": ErrorResponse,
    "error-409.json": ErrorResponse,
    "error-413.json": ErrorResponse,
    "error-503.json": ErrorResponse,
  };

  test("every fixture has a schema", () => {
    const files = readdirSync(new URL("api", import.meta.url)).filter((f) => f.endsWith(".json"));
    expect(files.sort()).toEqual(Object.keys(schemas).sort());
  });

  // Parsing strips unknown keys, so comparing the result with the input also catches extra fields.
  test.each(Object.entries(schemas))("%s matches its contract exactly", (file, schema) => {
    const json = readJson(`api/${file}`);
    expect(schema.parse(json)).toEqual(json);
  });

  test("the two parts pages are one listing sorted by part number", () => {
    const pages = [1, 2].map((n) => PartsResponse.parse(readJson(`api/parts-page-${n}.json`)));
    const items = pages.flatMap((page) => page.items);
    const keys = items.map((part) => part.partNumber.toUpperCase().replace(/[^A-Z0-9]/g, ""));
    expect(keys).toEqual([...keys].sort());
    expect(new Set(items.map((part) => part.id)).size).toBe(items.length);
    expect(pages[0]?.nextCursor).not.toBeNull();
    expect(pages[1]?.nextCursor).toBeNull();
  });

  test("quote totals add up, and the list agrees with the details", () => {
    const quotes = ["quote.json", "quote-created.json"].map((f) =>
      QuoteResponse.parse(readJson(`api/${f}`)),
    );
    for (const quote of quotes) {
      for (const line of quote.lines) {
        expect(cents(line.lineTotal)).toBe(cents(line.unitPrice) * line.quantity);
      }
      expect(cents(quote.total)).toBe(quote.lines.reduce((sum, l) => sum + cents(l.lineTotal), 0));
    }
    const list = QuoteListResponse.parse(readJson("api/quotes.json")).items;
    expect(list).toEqual(
      quotes
        .map(({ id, customerName, createdAt, lines, total }) => ({
          id,
          customerName,
          createdAt,
          lineCount: lines.length,
          total,
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  });
});

describe("import fixtures", () => {
  const ExpectedPart = z.strictObject({
    supplierKey: z.string(),
    partNumberKey: z.string(),
    supplier: z.string(),
    partNumber: z.string(),
    quantity: z.int().nonnegative().nullable(),
    price: z
      .string()
      .regex(/^\d+\.\d{2}$/)
      .nullable(),
    leadTimeDays: z.int().nonnegative().nullable(),
    lastUpdated: z.iso.datetime(),
    unavailableSinceStep: z.int().positive().nullable(),
  });
  const Expected = z.strictObject({
    steps: z.array(
      z.strictObject({
        file: z.enum(["night-1.csv", "night-2.csv"]),
        summary: ImportSummary.omit({ durationMs: true }).strict(),
        parts: z.array(ExpectedPart),
      }),
    ),
  });
  const { steps } = Expected.parse(readJson("imports/expected.json"));

  test.each(["night-1.csv", "night-2.csv"])("%s is shaped like the real export", (file) => {
    const bytes = read(`imports/${file}`);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString("latin1");
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
  });

  test("night-1.csv has a field that isn't valid UTF-8 (P2)", () => {
    expect(() =>
      new TextDecoder("utf-8", { fatal: true }).decode(read("imports/night-1.csv")),
    ).toThrow();
  });

  test.each(steps.map((step, index) => [index + 1, step] as const))(
    "step %i's summary adds up",
    (_, { file, summary }) => {
      const lines = read(`imports/${file}`).toString("latin1").split("\r\n").length - 2;
      expect(summary.rowsRead).toBe(lines);
      const rejected = Object.values(summary.rejected).reduce((sum, n) => sum + (n ?? 0), 0);
      const accepted =
        summary.inserted +
        summary.updated +
        summary.unchanged +
        summary.madeAvailable +
        summary.duplicatesCollapsed;
      expect(accepted + rejected).toBe(summary.rowsRead);
    },
  );

  test.each(steps.map((step, index) => [index + 1, step] as const))(
    "step %i's parts follow from the step before",
    (step, { summary, parts }) => {
      const before = steps[step - 2]?.parts ?? [];
      expect(parts.length).toBe(before.length + summary.inserted);
      const unavailable = (list: typeof parts) =>
        list.filter((p) => p.unavailableSinceStep !== null).length;
      expect(unavailable(parts)).toBe(
        unavailable(before) + summary.markedUnavailable - summary.madeAvailable,
      );
      for (const part of parts) expect(part.unavailableSinceStep ?? 0).toBeLessThanOrEqual(step);
    },
  );

  test("re-running a file changes nothing (R1.4)", () => {
    expect(steps[1]?.parts).toEqual(steps[0]?.parts);
    expect(steps[3]?.parts).toEqual(steps[2]?.parts);
  });

  test("every key is normalize_key of its display spelling (D13)", async () => {
    const parts = steps.flatMap((step) => step.parts);
    for (const part of parts) {
      const { rows } = await db.execute<{ supplier_key: string; part_number_key: string }>(
        sql`SELECT normalize_key(${part.supplier}) AS supplier_key, normalize_key(${part.partNumber}) AS part_number_key`,
      );
      expect(rows[0]).toEqual({
        supplier_key: part.supplierKey,
        part_number_key: part.partNumberKey,
      });
    }
  });
});
