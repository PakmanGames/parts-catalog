import { describe, expect, test } from "vitest";
import { CleanRow, NormalizedRow, REJECT_REASONS, RejectedRow } from "./import-rows";

const clean = {
  lineNumber: 3,
  partNumber: "AN960C10L",
  supplier: "ALLIED FASTENER SUPPLY",
  quantity: 1131,
  price: "9.15",
  leadTimeDays: 14,
  lastUpdated: new Date("2026-09-20T08:30:00Z"),
};

describe("REJECT_REASONS", () => {
  test("lists each reason once", () => {
    expect(new Set(REJECT_REASONS).size).toBe(REJECT_REASONS.length);
  });

  test("doesn't reject unknown quantities or prices, which become null (A19)", () => {
    expect(REJECT_REASONS).not.toContain("quantity is missing");
    expect(REJECT_REASONS).not.toContain("price is missing");
    expect(REJECT_REASONS).not.toContain("price is CALL");
  });
});

describe("CleanRow", () => {
  test("accepts a normalized row", () => {
    expect(CleanRow.parse(clean)).toEqual(clean);
  });

  test("accepts unknown values as null (A19, P24)", () => {
    const row = { ...clean, quantity: null, price: null, leadTimeDays: null };
    expect(CleanRow.parse(row)).toEqual(row);
  });

  test.each([
    ["the header line", { lineNumber: 1 }],
    ["a blank part number", { partNumber: "" }],
    ["a negative quantity", { quantity: -1 }],
    ["a quantity beyond Postgres integer", { quantity: 2_147_483_648 }],
    ["a price with a dollar sign", { price: "$9.15" }],
    ["a price with more than 2 decimal places", { price: "9.150" }],
    ["a price as a number", { price: 9.15 }],
    ["a timestamp as a string", { lastUpdated: "2026-09-20" }],
  ])("rejects %s", (_, change) => {
    expect(CleanRow.safeParse({ ...clean, ...change }).success).toBe(false);
  });
});

describe("RejectedRow", () => {
  test("carries the part and timestamp of a row rejected only for a bad value (A17)", () => {
    const row = {
      lineNumber: 34,
      reason: "quantity is negative",
      identity: {
        partNumber: "NAS1611-023R",
        supplier: "Bridgewater Avionics",
        lastUpdated: new Date("2026-09-15T00:00:00Z"),
      },
    };
    expect(RejectedRow.parse(row)).toEqual(row);
  });

  test("has no identity when the row was rejected before its part could be read", () => {
    const row = { lineNumber: 6, reason: "row is empty", identity: null };
    expect(RejectedRow.parse(row)).toEqual(row);
  });

  test("rejects a reason that isn't in the list", () => {
    expect(RejectedRow.safeParse({ lineNumber: 6, reason: "bad", identity: null }).success).toBe(
      false,
    );
  });
});

describe("NormalizedRow", () => {
  test("tells accepted rows from rejected ones by outcome", () => {
    const accepted = NormalizedRow.parse({ ...clean, outcome: "accepted" });
    const rejected = NormalizedRow.parse({
      outcome: "rejected",
      lineNumber: 6,
      reason: "row is empty",
      identity: null,
    });
    expect([accepted.outcome, rejected.outcome]).toEqual(["accepted", "rejected"]);
  });
});
