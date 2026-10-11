import { describe, expect, test } from "vitest";
import { checkLine, describeSaveError, newLineDraft, stockNote } from "./quote";

const part = {
  id: 1,
  partNumber: "AN960C10L",
  supplier: "Allied Fastener Supply",
  quantity: 20,
  price: "9.15",
  leadTimeDays: 21,
  lastUpdated: "2026-10-01T00:00:00.000Z",
  unavailableSince: null,
};

describe("newLineDraft", () => {
  test("starts at one unit at the part's price", () => {
    expect(newLineDraft(part)).toEqual({ quantity: "1", unitPrice: "9.15" });
  });

  test("starts with an empty price when the part's price is unknown, so the buyer must enter one", () => {
    expect(newLineDraft({ ...part, price: null })).toEqual({ quantity: "1", unitPrice: "" });
  });
});

describe("checkLine", () => {
  test("accepts a whole quantity and a price, trimming both", () => {
    expect(checkLine({ quantity: " 100 ", unitPrice: " 12.5 " })).toEqual({
      ok: true,
      quantity: 100,
      unitPrice: "12.5",
    });
  });

  test("accepts a free line", () => {
    expect(checkLine({ quantity: "1", unitPrice: "0" })).toMatchObject({ ok: true });
  });

  test.each([
    ["", "Enter a quantity"],
    ["1.5", "Quantity must be a whole number"],
    ["1e3", "Quantity must be a whole number"],
    ["-1", "Quantity must be a whole number"],
    ["0", "Quantity must be at least 1"],
    ["2147483648", "Quantity must be at most 2147483647"],
  ])("rejects the quantity %j with %j", (quantity, message) => {
    expect(checkLine({ quantity, unitPrice: "1.00" })).toEqual({
      ok: false,
      quantity: null,
      quantityError: message,
    });
  });

  test.each([
    ["", "Enter a unit price"],
    ["12.505", 'Must be a non-negative amount with at most 2 decimal places, such as "12.50"'],
    ["$12.50", 'Must be a non-negative amount with at most 2 decimal places, such as "12.50"'],
    ["-1", 'Must be a non-negative amount with at most 2 decimal places, such as "12.50"'],
  ])("rejects the unit price %j with %j", (unitPrice, message) => {
    expect(checkLine({ quantity: "3", unitPrice })).toEqual({
      ok: false,
      quantity: 3,
      unitPriceError: message,
    });
  });
});

describe("stockNote", () => {
  test("shows the stock and lead time when the quantity is covered", () => {
    expect(stockNote(part, 20)).toEqual({ text: "20 in stock, lead time 21 days", warning: false });
  });

  test("warns with the shortfall and the lead time when the quantity is above stock (A6)", () => {
    expect(stockNote({ ...part, quantity: 20 }, 100)).toEqual({
      text: "80 more than in stock, lead time 21 days",
      warning: true,
    });
  });

  test("counts the whole quantity as short for a part with no stock", () => {
    expect(stockNote({ ...part, quantity: 0 }, 5).text).toBe(
      "5 more than in stock, lead time 21 days",
    );
  });

  test("says so when the stock is unknown, whatever the quantity (A19)", () => {
    expect(stockNote({ ...part, quantity: null }, 1)).toEqual({
      text: "Stock unknown, lead time 21 days",
      warning: true,
    });
  });

  test("says so when the lead time is unknown", () => {
    expect(stockNote({ quantity: 2, leadTimeDays: null }, 3).text).toBe(
      "1 more than in stock, lead time unknown",
    );
    expect(stockNote({ quantity: null, leadTimeDays: null }, 3).text).toBe(
      "Stock unknown, lead time unknown",
    );
  });

  test("doesn't warn about a quantity that isn't valid yet", () => {
    expect(stockNote(part, null)).toEqual({
      text: "20 in stock, lead time 21 days",
      warning: false,
    });
  });
});

describe("describeSaveError", () => {
  test("names the line the buyer sees instead of its JSON path", () => {
    expect(describeSaveError("lines.0.quantity: Quantity must be at least 1")).toBe(
      "Line 1: Quantity must be at least 1",
    );
    expect(describeSaveError("lines.11.partId: AN960C10L is no longer available.")).toBe(
      "Line 12: AN960C10L is no longer available.",
    );
  });

  test("leaves other messages alone", () => {
    expect(describeSaveError("customerName: Customer name is required")).toBe(
      "customerName: Customer name is required",
    );
  });
});
