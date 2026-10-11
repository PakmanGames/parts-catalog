import { describe, expect, test } from "vitest";
import { formatCents, formatMoney, lineTotalCents, toCents } from "./money";

describe("toCents", () => {
  test.each([
    ["0", 0],
    ["0.00", 0],
    ["0.5", 50],
    ["0.05", 5],
    ["12", 1200],
    ["12.5", 1250],
    ["12.50", 1250],
    ["18.10", 1810],
    ["9999999999.99", 999999999999],
  ])("reads %j as %d cents", (amount, cents) => {
    expect(toCents(amount)).toBe(BigInt(cents));
  });

  test("keeps every cent of amounts beyond JavaScript's safe integers", () => {
    expect(toCents("123456789012345678.91")).toBe(BigInt("12345678901234567891"));
  });

  test.each([
    ["an empty string", ""],
    ["a negative amount", "-1.00"],
    ["more than two decimals", "12.505"],
    ["a trailing decimal point", "12."],
    ["a missing integer part", ".50"],
    ["exponent notation", "1e3"],
    ["surrounding whitespace", " 12.50"],
    ["a thousands separator", "1,234.50"],
    ["a currency sign", "$12.50"],
  ])("rejects %s", (_, amount) => {
    expect(() => toCents(amount)).toThrow(RangeError);
  });
});

describe("lineTotalCents", () => {
  test("multiplies exactly where floating point doesn't", () => {
    // 0.1 * 3 is 0.30000000000000004 as a JavaScript number.
    expect(lineTotalCents("0.10", 3)).toBe(BigInt(30));
    expect(lineTotalCents("19.99", 7)).toBe(BigInt(13993));
  });

  test("handles the largest price and quantity the database allows", () => {
    // numeric(12, 2) times a Postgres integer, far past 2^53 cents.
    expect(lineTotalCents("9999999999.99", 2_147_483_647)).toBe(BigInt("2147483646997852516353"));
  });

  test("adds up to an exact quote total", () => {
    const lines = [
      { unitPrice: "0.10", quantity: 1 },
      { unitPrice: "0.20", quantity: 1 },
    ];
    const total = lines.reduce(
      (sum, line) => sum + lineTotalCents(line.unitPrice, line.quantity),
      BigInt(0),
    );
    expect(formatCents(total)).toBe("$0.30");
  });

  test("rejects a fractional quantity", () => {
    expect(() => lineTotalCents("1.00", 1.5)).toThrow(RangeError);
  });
});

describe("formatCents", () => {
  test.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [50, "$0.50"],
    [1250, "$12.50"],
    [123450, "$1,234.50"],
    [100000000, "$1,000,000.00"],
  ])("formats %d cents as %j", (cents, formatted) => {
    expect(formatCents(BigInt(cents))).toBe(formatted);
  });

  test("groups digits beyond JavaScript's safe integers without rounding", () => {
    expect(formatCents(BigInt("2147483646997852516353"))).toBe("$21,474,836,469,978,525,163.53");
  });
});

describe("formatMoney", () => {
  test.each([
    ["125.00", "$125.00"],
    ["1234.5", "$1,234.50"],
    ["0", "$0.00"],
  ])("formats %j as %j", (amount, formatted) => {
    expect(formatMoney(amount)).toBe(formatted);
  });
});
