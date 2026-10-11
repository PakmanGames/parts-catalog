import { describe, expect, test } from "vitest";
import { Money, MoneyInput } from "./common";

describe("MoneyInput", () => {
  test.each(["0", "0.00", "0.5", "12.5", "12.50", "9999999999.99"])("accepts %j", (value) => {
    expect(MoneyInput.safeParse(value).success).toBe(true);
  });

  test.each([
    ["a negative amount", "-1.00"],
    ["more decimals than the column stores", "12.505"],
    ["more integer digits than the column stores", "10000000000.00"],
    ["exponent notation", "1e3"],
    ["surrounding whitespace", " 12.50"],
    ["a trailing decimal point", "12."],
    ["a missing integer part", ".50"],
    ["a leading zero", "012.50"],
    ["an empty string", ""],
    ["a JSON number instead of a string", 12.5],
  ])("rejects %s", (_, value) => {
    expect(MoneyInput.safeParse(value).success).toBe(false);
  });
});

describe("Money", () => {
  test("accepts amounts formatted like Postgres numeric, including totals beyond one column", () => {
    expect(Money.safeParse("125.00").success).toBe(true);
    expect(Money.safeParse("123456789012345.00").success).toBe(true);
  });

  test.each(["125", "125.0", "-1.00"])("rejects %j", (value) => {
    expect(Money.safeParse(value).success).toBe(false);
  });
});
