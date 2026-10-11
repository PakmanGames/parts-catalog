import { describe, expect, test } from "vitest";
import { NormalizedRow, REJECT_REASONS, type RejectReason } from "@/contracts/import-rows";
import { normalizeRow } from "./normalize-row";

const HEADER = [
  "Part Number",
  "NSN",
  "Description",
  "Supplier",
  "Qty On Hand",
  "Unit Price",
  "Lead Time",
  "Last Updated",
];

const valid = {
  partNumber: "MS21045L176",
  nsn: "5305-01-468-1993",
  description: "SCREW,MACHINE 1/4-28 UNF",
  supplier: "Allied Fastener Supply",
  quantity: "27",
  price: "19.11",
  leadTime: "120",
  lastUpdated: "2025-06-13",
};
type Column = keyof typeof valid;

/** The part and timestamp of the valid row. */
const validIdentity = {
  partNumber: "MS21045L176",
  supplier: "Allied Fastener Supply",
  lastUpdated: new Date("2025-06-13T00:00:00Z"),
};

const MAX_INTEGER = 2_147_483_647;

/** The 8 fields of a valid row, with the given columns replaced. */
function fields(columns: Partial<Record<Column, string>> = {}): string[] {
  return Object.values({ ...valid, ...columns });
}

/** Normalizes a row on line 2, and checks that the result matches the contract exactly. */
function normalize(row: string[]): NormalizedRow {
  const result = normalizeRow(2, row);
  // Parsing strips unknown keys, so comparing the result with the input also catches extra fields.
  expect(NormalizedRow.parse(result)).toEqual(result);
  return result;
}

function accepted(row: string[]) {
  const result = normalize(row);
  if (result.outcome === "rejected") throw new Error(`Expected acceptance, got: ${result.reason}`);
  return result;
}

// One example per reason, typed so that a reason added to the contract doesn't compile until it has
// an example here.
const examples: Record<RejectReason, string[]> = {
  "row is empty": [""],
  "row has too few columns": fields().slice(0, 3),
  "row is a repeated header": HEADER,
  "part number is missing": fields({ partNumber: "" }),
  "part number has no letters or digits": fields({ partNumber: "--/--" }),
  "supplier is missing": fields({ supplier: "" }),
  "supplier has no letters or digits": fields({ supplier: "..." }),
  "quantity is negative": fields({ quantity: "-6" }),
  "quantity is not a whole number": fields({ quantity: "12.5" }),
  "quantity is too large": fields({ quantity: "2147483648" }),
  "price is negative": fields({ price: "-23.55" }),
  "price is not a number": fields({ price: "12.3.4" }),
  "price has more than 2 decimal places": fields({ price: "1.2345" }),
  "price is too large": fields({ price: "99999999999.00" }),
  "lead time is not a number of days or weeks": fields({ leadTime: "2 months" }),
  "lead time is too large": fields({ leadTime: "2147483648" }),
  "last updated is missing": fields({ lastUpdated: "" }),
  "last updated is not a valid date": fields({ lastUpdated: "02/30/2025" }),
};

/** The reasons for a bad quantity, price, or lead time, after which the row keeps its part (A17). */
const valueReasons = REJECT_REASONS.filter((reason) => /^(quantity|price|lead time) /.test(reason));

describe("normalizeRow", () => {
  test("accepts a valid row", () => {
    expect(normalize(fields())).toEqual({
      outcome: "accepted",
      lineNumber: 2,
      partNumber: "MS21045L176",
      supplier: "Allied Fastener Supply",
      quantity: 27,
      price: "19.11",
      leadTimeDays: 120,
      lastUpdated: new Date("2025-06-13T00:00:00Z"),
    });
  });

  test.each(REJECT_REASONS)("rejects a row: %s", (reason) => {
    expect(normalize(examples[reason])).toMatchObject({
      outcome: "rejected",
      lineNumber: 2,
      reason,
    });
  });

  test.each([
    ["an empty line (P3)", [""]],
    ["a line of seven commas (P3)", ["", "", "", "", "", "", "", ""]],
    ["a line of blank fields", [" ", "  ", "", "", "", "", "", " "]],
    ["a line of spaces", ["   "]],
    ["a short line of blank fields", ["", "", ""]],
  ])("rejects %s: row is empty", (_, row) => {
    expect(normalize(row)).toMatchObject({ reason: "row is empty" });
  });

  test.each([1, 2, 3, 4, 5, 6, 7])(
    "rejects a row cut off after %i fields (P4): row has too few columns",
    (count) => {
      expect(normalize(fields().slice(0, count))).toMatchObject({
        reason: "row has too few columns",
      });
    },
  );

  test.each([
    ["exactly as on line 1 (P6)", HEADER],
    ["with padding", HEADER.map((name) => ` ${name} `)],
  ])("rejects a repeated header %s", (_, row) => {
    expect(normalize(row)).toMatchObject({ reason: "row is a repeated header" });
  });

  test.each([
    [9, ["SCREW", "MACHINE 1/4-28 UNF"]],
    [10, ["SCREW", "CAP", "HEXAGON HEAD #6-32 UNC"]],
  ])(
    "reads a row of %i fields, whose Description has unquoted commas (P5)",
    (count, description) => {
      const row = ["AN6C35", "5305017414860", ...description, "Tri-County Fastener"];
      row.push("27", "19.11", "120", "2025-06-13");
      expect(row).toHaveLength(count);
      expect(normalize(row)).toEqual({
        outcome: "accepted",
        lineNumber: 2,
        partNumber: "AN6C35",
        supplier: "Tri-County Fastener",
        quantity: 27,
        price: "19.11",
        leadTimeDays: 120,
        lastUpdated: new Date("2025-06-13T00:00:00Z"),
      });
    },
  );

  // `normalize` already checks that no field beyond the contract's comes through.
  test.each([
    ["dashed", "5305-01-468-1993"],
    ["13 digits", "5305012416268"],
    ["12 digits, cut off (P30)", "530501241626"],
    ["blank", ""],
  ])("drops Description and an NSN that is %s (D20)", (_, nsn) => {
    accepted(fields({ nsn, description: " SEAL,PLAIN ENCASED Ø34MM " }));
  });

  describe("rejects a row for its first failing check", () => {
    test.each([
      [["", "", ""], "row is empty"],
      [["", "5305012416268", "SEAL"], "row has too few columns"],
      [["Part Number", "NSN", "Description"], "row has too few columns"],
      [
        fields({ partNumber: "", supplier: "", quantity: "-1", lastUpdated: "" }),
        "part number is missing",
      ],
      [fields({ partNumber: "--", supplier: "" }), "part number has no letters or digits"],
      [fields({ supplier: "", quantity: "-1" }), "supplier is missing"],
      [fields({ supplier: "...", quantity: "-1" }), "supplier has no letters or digits"],
      [
        fields({ quantity: "-1", price: "-1.00", leadTime: "soon", lastUpdated: "" }),
        "quantity is negative",
      ],
      [fields({ quantity: "1.5", price: "-1.00" }), "quantity is not a whole number"],
      [fields({ quantity: "2147483648", price: "free" }), "quantity is too large"],
      [fields({ price: "-1.00", leadTime: "soon", lastUpdated: "" }), "price is negative"],
      [fields({ price: "free", leadTime: "2147483648" }), "price is not a number"],
      [fields({ price: "1.234", leadTime: "soon" }), "price has more than 2 decimal places"],
      [fields({ price: "10000000000.00", leadTime: "soon" }), "price is too large"],
      [fields({ leadTime: "soon", lastUpdated: "" }), "lead time is not a number of days or weeks"],
      [fields({ leadTime: "2147483648", lastUpdated: "never" }), "lead time is too large"],
      [fields({ quantity: "N/A", price: "CALL", lastUpdated: "" }), "last updated is missing"],
    ])("%j: %s", (row, reason) => {
      expect(normalize(row)).toMatchObject({ outcome: "rejected", reason });
    });
  });

  describe("identity of a rejected row (A17)", () => {
    test.each(valueReasons)("is the part and timestamp when rejected for %s", (reason) => {
      expect(normalize(examples[reason])).toEqual({
        outcome: "rejected",
        lineNumber: 2,
        reason,
        identity: validIdentity,
      });
    });

    test("uses the normalized spellings and timestamp", () => {
      const row = fields({
        partNumber: " ms21045l176 ",
        supplier: "  allied  fastener supply ",
        quantity: "-6",
        lastUpdated: "2025-09-26T11:20:42Z",
      });
      expect(normalize(row)).toMatchObject({
        identity: {
          partNumber: "MS21045L176",
          supplier: "allied fastener supply",
          lastUpdated: new Date("2025-09-26T11:20:42Z"),
        },
      });
    });

    test.each([
      ["missing", ""],
      ["not a valid date", "02/30/2025"],
    ])("is null when the timestamp is %s", (_, lastUpdated) => {
      expect(normalize(fields({ quantity: "-6", lastUpdated }))).toEqual({
        outcome: "rejected",
        lineNumber: 2,
        reason: "quantity is negative",
        identity: null,
      });
    });

    test.each(REJECT_REASONS.filter((reason) => !valueReasons.includes(reason)))(
      "is null when rejected for %s",
      (reason) => {
        expect(normalize(examples[reason])).toMatchObject({ reason, identity: null });
      },
    );
  });
});

describe("Part Number", () => {
  test.each([
    ["MS21045L176", "MS21045L176"],
    ["MS21045L176  ", "MS21045L176"], // trailing spaces (P8)
    [" D38999/24JG62SC ", "D38999/24JG62SC"], // leading and trailing spaces (P8)
    ["un16492", "UN16492"], // lower case (P9, A13)
    ["81h37815-5", "81H37815-5"],
    // Dashes and slashes stay for display; normalize_key ignores them (A16).
    ["NAS1149-500R", "NAS1149-500R"],
    ["M83248/2-390", "M83248/2-390"],
    ["6036-2327-65", "6036-2327-65"],
  ])("reads %j as %j", (partNumber, expected) => {
    expect(accepted(fields({ partNumber })).partNumber).toBe(expected);
  });

  test.each([
    ["", "part number is missing"], // P7
    ["   ", "part number is missing"],
    ["-/-", "part number has no letters or digits"],
    // Letters outside A-Z don't count, as in normalize_key.
    ["ÉÈ", "part number has no letters or digits"],
  ])("rejects %j: %s", (partNumber, reason) => {
    expect(normalize(fields({ partNumber }))).toMatchObject({ reason });
  });
});

describe("Supplier", () => {
  // The six ways each supplier is written (P10). Case and a trailing period are kept, because the
  // loader picks the most common spelling for display (A13).
  test.each([
    ["Allied Fastener Supply", "Allied Fastener Supply"],
    ["ALLIED FASTENER SUPPLY", "ALLIED FASTENER SUPPLY"],
    ["allied fastener supply", "allied fastener supply"],
    ["  Allied Fastener Supply ", "Allied Fastener Supply"],
    ["Allied Fastener Supply.", "Allied Fastener Supply."],
    ["Allied  Fastener Supply", "Allied Fastener Supply"],
    ["Allied\tFastener \u00a0 Supply", "Allied Fastener Supply"],
    ["Delta Wire & Cable", "Delta Wire & Cable"],
  ])("reads %j as %j", (supplier, expected) => {
    expect(accepted(fields({ supplier })).supplier).toBe(expected);
  });

  test.each([
    ["", "supplier is missing"],
    ["   ", "supplier is missing"],
    ["& .", "supplier has no letters or digits"],
  ])("rejects %j: %s", (supplier, reason) => {
    expect(normalize(fields({ supplier }))).toMatchObject({ reason });
  });
});

describe("Qty On Hand", () => {
  // Every shape in data profile section 3, and the edges of the rules.
  test.each([
    ["27", 27], // 99
    ["5", 5], // 9
    ["142", 142], // 999
    ["1234", 1234], // 9999
    ["25000", 25000], // 99999
    ["0", 0], // a real value, not a sentinel
    ["142.0", 142], // 99.9 (P13)
    ["5.0", 5], // 9.9
    ["999.0", 999], // 999.9
    ["1234.0", 1234], // 9999.9
    ["25000.0", 25000], // 99999.9
    ["12.000", 12],
    ["1,131", 1131], // 9,999 (P12)
    ["25,000", 25000], // 99,999
    ["1,131.0", 1131],
    [" 12 ", 12],
    [String(MAX_INTEGER), MAX_INTEGER],
    ["", null], // blank (P11, A19)
    ["N/A", null], // a/a (P11, A19)
    ["n/a", null],
  ])("reads %j as %j", (quantity, expected) => {
    expect(accepted(fields({ quantity })).quantity).toBe(expected);
  });

  test.each([
    ["-6", "quantity is negative"], // -9 (P14)
    ["-11", "quantity is negative"], // -99
    ["-1,131", "quantity is negative"],
    ["1.5", "quantity is not a whole number"],
    ["1,23", "quantity is not a whole number"],
    ["+5", "quantity is not a whole number"],
    ["5 units", "quantity is not a whole number"],
    ["many", "quantity is not a whole number"],
    [String(MAX_INTEGER + 1), "quantity is too large"],
    ["2,147,483,648", "quantity is too large"],
    ["99999999999999999999999", "quantity is too large"],
  ])("rejects %j: %s", (quantity, reason) => {
    expect(normalize(fields({ quantity }))).toMatchObject({ reason });
  });
});

describe("Unit Price", () => {
  // Every one of the 41 shapes in the file (data profile section 9), and the edges of the rules.
  test.each([
    ["0.40", "0.40"], // 9.99
    ["23.69", "23.69"], // 99.99
    ["271.88", "271.88"], // 999.99
    ["9361.09", "9361.09"], // 9999.99
    ["15839.85", "15839.85"], // 99999.99
    ["$0.29", "0.29"], // $9.99 (P17)
    ["$14.37", "14.37"], // $99.99
    ["$914.37", "914.37"], // $999.99
    ["$9,361.09", "9361.09"], // $9,999.99 (P19)
    ["$15,839.85", "15839.85"], // $99,999.99
    ["3.7700", "3.77"], // 9.9999 (P20)
    ["64.7300", "64.73"], // 99.9999
    ["964.7300", "964.73"], // 999.9999
    ["9964.7300", "9964.73"], // 9999.9999
    ["15839.8500", "15839.85"], // 99999.9999
    [" 0.40 ", "0.40"], // " 9.99 " (P21)
    [" 23.69 ", "23.69"], // " 99.99 "
    [" 271.88 ", "271.88"], // " 999.99 "
    [" 9361.09 ", "9361.09"], // " 9999.99 "
    [" 15839.85 ", "15839.85"], // " 99999.99 "
    ["1.44 USD", "1.44"], // "9.99 aaa" (P18)
    ["21.56 USD", "21.56"], // "99.99 aaa"
    ["271.88 USD", "271.88"], // "999.99 aaa"
    ["9271.88 USD", "9271.88"], // "9999.99 aaa"
    ["15271.88 USD", "15271.88"], // "99999.99 aaa"
    ["18.1", "18.10"], // 9.9 (P22)
    ["26.5", "26.50"], // 99.9
    ["126.5", "126.50"], // 999.9
    ["1126.5", "1126.50"], // 9999.9
    ["11126.5", "11126.50"], // 99999.9
    ["4", "4.00"], // 9
    ["26", "26.00"], // 99
    ["126", "126.00"], // 999
    ["1126", "1126.00"], // 9999
    ["", null], // blank (P15, A19)
    ["CALL", null], // aaaa (P16, A19)
    ["call", null],
    ["0", "0.00"],
    ["0.00", "0.00"],
    ["64.70000", "64.70"],
    ["1.44usd", "1.44"],
    ["$ 1.44", "1.44"],
    ["$1,234.50 USD", "1234.50"],
    ["1,234.50", "1234.50"],
    ["007.50", "7.50"],
    ["9999999999.99", "9999999999.99"], // the largest numeric(12, 2)
    ["00000000012.50", "12.50"], // leading zeros don't make it too large
  ])("reads %j as %j", (price, expected) => {
    expect(accepted(fields({ price })).price).toBe(expected);
  });

  test.each([
    ["-0.69", "price is negative"], // -9.99 (P23)
    ["-23.55", "price is negative"], // -99.99
    ["-423.55", "price is negative"], // -999.99
    ["-1570.04", "price is negative"], // -9999.99
    ["-11570.04", "price is negative"], // -99999.99
    ["$-5.00", "price is negative"],
    ["-5.00 USD", "price is negative"],
    ["free", "price is not a number"],
    ["$", "price is not a number"],
    ["12.", "price is not a number"],
    [".50", "price is not a number"],
    ["1.2.3", "price is not a number"],
    ["1,23.00", "price is not a number"],
    ["12.00 EUR", "price is not a number"],
    ["£12.00", "price is not a number"],
    ["64.735", "price has more than 2 decimal places"],
    ["64.7350", "price has more than 2 decimal places"],
    ["10000000000.00", "price is too large"],
    ["$10,000,000,000.00", "price is too large"],
  ])("rejects %j: %s", (price, reason) => {
    expect(normalize(fields({ price }))).toMatchObject({ reason });
  });
});

describe("Lead Time", () => {
  // Every form in data profile section 3, and the edges of the rules.
  test.each([
    ["0", 0], // N
    ["120", 120],
    ["STOCK", 0], // P25
    ["stock", 0],
    ["90 days", 90], // N days (P26)
    ["84 DAYS", 84], // N DAYS
    ["56d", 56], // Nd
    ["12 weeks", 84], // N weeks
    ["3 WKS", 21], // N WKS
    ["3 wks", 21], // N wks
    ["1 wk", 7], // N wk
    ["1 day", 1],
    ["1 week", 7],
    ["7D", 7],
    ["2wks", 14],
    [" 14 ", 14],
    [String(MAX_INTEGER), MAX_INTEGER],
    ["306783378 weeks", 306783378 * 7],
    ["", null], // blank (P24)
    ["TBD", null], // P24
    ["tbd", null],
  ])("reads %j as %j days", (leadTime, expected) => {
    expect(accepted(fields({ leadTime })).leadTimeDays).toBe(expected);
  });

  test.each([
    ["soon", "lead time is not a number of days or weeks"],
    ["-7", "lead time is not a number of days or weeks"],
    ["1.5 weeks", "lead time is not a number of days or weeks"],
    ["3 months", "lead time is not a number of days or weeks"],
    ["10 business days", "lead time is not a number of days or weeks"],
    [String(MAX_INTEGER + 1), "lead time is too large"],
    ["306783379 weeks", "lead time is too large"],
  ])("rejects %j: %s", (leadTime, reason) => {
    expect(normalize(fields({ leadTime }))).toMatchObject({ reason });
  });
});

describe("Last Updated", () => {
  test.each([
    ["2025-04-04", "2025-04-04T00:00:00.000Z"], // 9999-99-99 (P28)
    ["03/18/2026", "2026-03-18T00:00:00.000Z"], // 99/99/9999
    ["12/24/2024", "2024-12-24T00:00:00.000Z"], // the second number is the day
    ["2025-09-26T11:20:42Z", "2025-09-26T11:20:42.000Z"], // 9999-99-99a99:99:99a
    ["2024-02-29", "2024-02-29T00:00:00.000Z"],
    ["02/29/2024", "2024-02-29T00:00:00.000Z"],
    ["2025-12-31T23:59:59Z", "2025-12-31T23:59:59.000Z"],
    ["2027-04-16", "2027-04-16T00:00:00.000Z"], // in the future (P29, A18)
    ["2027-01-20T04:07:54Z", "2027-01-20T04:07:54.000Z"],
    [" 2025-04-04 ", "2025-04-04T00:00:00.000Z"],
  ])("reads %j as %s", (lastUpdated, expected) => {
    expect(accepted(fields({ lastUpdated })).lastUpdated.toISOString()).toBe(expected);
  });

  test.each([
    ["", "last updated is missing"], // P27
    ["  ", "last updated is missing"],
    ["02/30/2025", "last updated is not a valid date"],
    ["2025-02-29", "last updated is not a valid date"],
    ["2025-04-31", "last updated is not a valid date"],
    ["2025-13-01", "last updated is not a valid date"],
    ["2025-00-10", "last updated is not a valid date"],
    ["13/01/2025", "last updated is not a valid date"],
    ["0099-06-13", "last updated is not a valid date"], // Date.UTC would read it as 1999
    ["2025-06-13T24:00:00Z", "last updated is not a valid date"],
    ["2025-06-13T12:60:00Z", "last updated is not a valid date"],
    ["2025-06-13T12:00:60Z", "last updated is not a valid date"],
    ["2025-06-13T12:00:00", "last updated is not a valid date"],
    ["2025-06-13T12:00:00+02:00", "last updated is not a valid date"],
    ["2025-06-13 12:00:00", "last updated is not a valid date"],
    ["3/5/2025", "last updated is not a valid date"],
    ["2025/06/13", "last updated is not a valid date"],
    ["1749772800", "last updated is not a valid date"],
  ])("rejects %j: %s", (lastUpdated, reason) => {
    expect(normalize(fields({ lastUpdated }))).toMatchObject({ reason, identity: null });
  });
});
