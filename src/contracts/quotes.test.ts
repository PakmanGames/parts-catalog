import { describe, expect, test } from "vitest";
import { CreateQuoteRequest, QuoteIdParam, QuoteListResponse, QuoteResponse } from "./quotes";

const validRequest = {
  customerName: "Initech",
  lines: [{ partId: 42, quantity: 10, unitPrice: "12.50" }],
};

/** Paths of the issues that make `input` invalid, such as `lines.1.partId`. */
function issuePaths(input: unknown): string[] {
  const result = CreateQuoteRequest.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("CreateQuoteRequest", () => {
  test("accepts the PRD 7.4 example", () => {
    expect(CreateQuoteRequest.parse(validRequest)).toEqual(validRequest);
  });

  test("trims the customer name", () => {
    const parsed = CreateQuoteRequest.parse({ ...validRequest, customerName: "  Initech  " });
    expect(parsed.customerName).toBe("Initech");
  });

  test.each([
    ["a missing customer name", { lines: validRequest.lines }, "customerName"],
    ["a blank customer name", { ...validRequest, customerName: "   " }, "customerName"],
    ["no lines", { ...validRequest, lines: [] }, "lines"],
  ])("rejects %s", (_, input, path) => {
    expect(issuePaths(input)).toEqual([path]);
  });

  test.each([
    ["zero", 0],
    ["a negative quantity", -1],
    ["a fractional quantity", 1.5],
    ["a quantity beyond Postgres integer", 2_147_483_648],
    ["a quantity sent as a string", "10"],
  ])("rejects %s as a quantity", (_, quantity) => {
    const input = { ...validRequest, lines: [{ ...validRequest.lines[0], quantity }] };
    expect(issuePaths(input)).toEqual(["lines.0.quantity"]);
  });

  test.each([
    ["a negative unit price", "-1.00"],
    ["a unit price sent as a number", 12.5],
  ])("rejects %s", (_, unitPrice) => {
    const input = { ...validRequest, lines: [{ ...validRequest.lines[0], unitPrice }] };
    expect(issuePaths(input)).toEqual(["lines.0.unitPrice"]);
  });

  test("accepts a free line with a unit price of zero", () => {
    const input = { ...validRequest, lines: [{ partId: 42, quantity: 1, unitPrice: "0" }] };
    expect(CreateQuoteRequest.safeParse(input).success).toBe(true);
  });

  test("rejects a part that appears on more than one line, pointing at the repeat", () => {
    const input = {
      ...validRequest,
      lines: [
        { partId: 42, quantity: 1, unitPrice: "1.00" },
        { partId: 7, quantity: 1, unitPrice: "1.00" },
        { partId: 42, quantity: 2, unitPrice: "1.00" },
      ],
    };
    expect(issuePaths(input)).toEqual(["lines.2.partId"]);
  });
});

describe("QuoteIdParam", () => {
  test("parses a positive integer", () => {
    expect(QuoteIdParam.parse("42")).toBe(42);
  });

  test.each([
    "0",
    "-1",
    "1.5",
    "1e3",
    "042",
    "abc",
    "",
    // One past 2^53 - 1: as a JavaScript number it would silently become a different id.
    "9007199254740993",
  ])("rejects %j", (value) => {
    expect(QuoteIdParam.safeParse(value).success).toBe(false);
  });
});

describe("responses", () => {
  test("QuoteResponse accepts the PRD 7.4 example", () => {
    const example = {
      id: 1,
      customerName: "Initech",
      createdAt: "2026-10-10T15:02:00Z",
      lines: [
        {
          partId: 42,
          partNumber: "AB-1234",
          supplier: "Acme Supply",
          quantity: 10,
          unitPrice: "12.50",
          lineTotal: "125.00",
        },
      ],
      total: "125.00",
    };
    expect(QuoteResponse.parse(example)).toEqual(example);
  });

  test("QuoteListResponse accepts the PRD 7.4 example", () => {
    const example = {
      items: [
        {
          id: 1,
          customerName: "Initech",
          createdAt: "2026-10-10T15:02:00Z",
          lineCount: 1,
          total: "125.00",
        },
      ],
    };
    expect(QuoteListResponse.parse(example)).toEqual(example);
  });
});
