import { beforeAll, describe, expect, test } from "vitest";
import { PartSort, type PartsQuery, PartsResponse, SortDirection } from "@/contracts/parts";
import { parts } from "@/db/schema";
import { createTestDb } from "../../../tests/db";
import { InvalidCursorError, listParts } from "./list-parts";

const db = await createTestDb();

const SUPPLIERS = [
  "Allied Fastener Supply",
  "Anchor Fluid Power",
  "Bay Aero Components",
  "Delta Wire & Cable",
];
const PRICES = ["0.40", "12.50", "12.50", "99.99", "1604.20"];
const LEAD_TIMES = [0, 7, 14];
const UNAVAILABLE_SINCE = new Date("2026-10-11T02:00:05Z");
const LAST_UPDATED = new Date("2026-09-01T00:00:00Z");

/** Part numbers for the search tests, all at one supplier, with every value unknown. */
const SEARCH_SUPPLIER = "Search Test Co";
const SEARCH_NUMBERS = ["AB-123-X", "AB1234", "XAB123", "AXB123", "A1B23", "ZZ999"];

type Seeded = {
  id: number;
  supplierKey: string;
  partNumberKey: string;
  quantity: number | null;
  price: string | null;
  leadTimeDays: number | null;
};
let seeded: Seeded[] = [];

beforeAll(async () => {
  // 160 parts with long runs of ties (lead time has 3 values, quantity 6) and unknown values in
  // every nullable column, so paging crosses tie runs and the known-to-unknown boundary mid-page.
  const catalog = Array.from({ length: 160 }, (_, i) => ({
    supplier: SUPPLIERS[i % SUPPLIERS.length] ?? "",
    partNumber: `${["AN", "MS", "NAS"][i % 3]}${(i * 7919) % 10007}-${i % 10}`,
    quantity: i % 9 === 0 ? null : (i * 13) % 6,
    price: i % 11 === 0 ? null : (PRICES[i % PRICES.length] ?? null),
    leadTimeDays: i % 13 === 0 ? null : (LEAD_TIMES[i % LEAD_TIMES.length] ?? null),
    lastUpdated: LAST_UPDATED,
    unavailableSince: i % 17 === 0 ? UNAVAILABLE_SINCE : null,
  }));
  const searchable = [
    ...SEARCH_NUMBERS.map((partNumber) => ({ supplier: SEARCH_SUPPLIER, partNumber })),
    { supplier: "Other Co", partNumber: "AB-123-X" },
  ].map((part) => ({ ...part, lastUpdated: LAST_UPDATED }));
  seeded = await db
    .insert(parts)
    .values([...catalog, ...searchable])
    .returning({
      id: parts.id,
      supplierKey: parts.supplierKey,
      partNumberKey: parts.partNumberKey,
      quantity: parts.quantity,
      price: parts.price,
      leadTimeDays: parts.leadTimeDays,
    });
});

/** The value each sort orders by, with prices in cents so they compare as numbers. */
function sortValue(part: Seeded, sort: PartSort): string | number | null {
  if (sort === "part_number") return part.partNumberKey;
  if (sort === "quantity") return part.quantity;
  if (sort === "price") return part.price === null ? null : Math.round(Number(part.price) * 100);
  return part.leadTimeDays;
}

/** The order the API promises: by value then id, both in `dir`, and unknown values last either way. */
function expectedIds(rows: Seeded[], sort: PartSort, dir: SortDirection): number[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .toSorted((a, b) => {
      const [x, y] = [sortValue(a, sort), sortValue(b, sort)];
      if (x === null || y === null) {
        if (x !== y) return x === null ? 1 : -1;
      } else if (x !== y) {
        return sign * (x < y ? -1 : 1);
      }
      return sign * (a.id - b.id);
    })
    .map((part) => part.id);
}

const query = (overrides: Partial<PartsQuery> = {}): PartsQuery => ({
  supplier: [],
  sort: "part_number",
  dir: "asc",
  limit: 50,
  ...overrides,
});

/** Follows `nextCursor` to the end, checking every response against the contract. */
async function readAllPages(base: PartsQuery): Promise<number[]> {
  const ids: number[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 1000; pages++) {
    const response = await listParts(db, { ...base, cursor });
    expect(PartsResponse.parse(response)).toEqual(response);
    if (response.nextCursor !== null) expect(response.items).toHaveLength(base.limit);
    ids.push(...response.items.map((item) => item.id));
    if (response.nextCursor === null) return ids;
    cursor = response.nextCursor;
  }
  throw new Error("Paging never ended");
}

const sortsAndDirections = PartSort.options.flatMap((sort) =>
  SortDirection.options.map((dir) => ({ sort, dir })),
);

describe("listParts paging", () => {
  // Comparing the concatenated pages with the full expected order proves that no row repeats or
  // goes missing, through ties and across the boundary between known and unknown values.
  test.each(
    sortsAndDirections.flatMap((combo) => [1, 7, 200].map((limit) => ({ ...combo, limit }))),
  )(
    "pages by $sort $dir, $limit at a time, in order without gaps",
    async ({ sort, dir, limit }) => {
      expect(await readAllPages(query({ sort, dir, limit }))).toEqual(
        expectedIds(seeded, sort, dir),
      );
    },
  );

  test.each(sortsAndDirections)(
    "pages by $sort $dir with a search and two suppliers",
    async ({ sort, dir }) => {
      const base = query({
        sort,
        dir,
        limit: 5,
        q: "an",
        supplier: ["allied fastener supply", "BAY AERO COMPONENTS"],
      });
      const matching = seeded.filter(
        (part) =>
          part.partNumberKey.includes("AN") &&
          ["ALLIEDFASTENERSUPPLY", "BAYAEROCOMPONENTS"].includes(part.supplierKey),
      );
      expect(matching.length).toBeGreaterThan(10);
      expect(await readAllPages(base)).toEqual(expectedIds(matching, sort, dir));
    },
  );

  test.each(SortDirection.options)("puts unknown values last when sorting %s", async (dir) => {
    for (const sort of ["quantity", "price", "lead_time"] as const) {
      const { items } = await listParts(db, query({ sort, dir, limit: 200 }));
      const field = { quantity: "quantity", price: "price", lead_time: "leadTimeDays" } as const;
      const values = items.map((item) => item[field[sort]]);
      const firstUnknown = values.indexOf(null);
      expect(firstUnknown).toBeGreaterThan(0);
      expect(values.slice(firstUnknown).every((value) => value === null)).toBe(true);
    }
  });

  test("returns unavailable parts with the time they became unavailable", async () => {
    const { items } = await listParts(db, query({ limit: 200 }));
    const unavailable = items.filter((item) => item.unavailableSince !== null);
    expect(unavailable).toHaveLength(seeded.filter((_, i) => i % 17 === 0).length);
    expect(unavailable[0]?.unavailableSince).toBe(UNAVAILABLE_SINCE.toISOString());
  });
});

describe("listParts search and supplier filter", () => {
  const search = async (q: string, supplier = [SEARCH_SUPPLIER]) => {
    const { items } = await listParts(db, query({ q, supplier, limit: 200 }));
    return items.map((item) => item.partNumber).sort();
  };

  test.each(["ab 123", "AB-123", "a.b/1 2-3", "  ab123  "])(
    "ignores spaces, punctuation, and case in the search %j",
    async (q) => {
      expect(await search(q)).toEqual(["AB-123-X", "AB1234", "XAB123"]);
    },
  );

  // As wildcards, `%` and `_` would also match AXB123 and A1B23.
  test.each(["a%b123", "a_b123", "A%B%123"])("never treats %j as a LIKE pattern", async (q) => {
    expect(await search(q)).toEqual(["AB-123-X", "AB1234", "XAB123"]);
  });

  test.each(["", "%", "_", " - "])(
    "treats %j, which normalizes to nothing, as no search",
    async (q) => {
      expect(await search(q)).toEqual([...SEARCH_NUMBERS].sort());
    },
  );

  test.each(["search test co", "  SEARCH  TEST CO. ", "Search-Test-Co"])(
    "ignores spaces, punctuation, and case in the supplier %j",
    async (supplier) => {
      expect(await search("ab123", [supplier])).toEqual(["AB-123-X", "AB1234", "XAB123"]);
    },
  );

  test("returns exactly the parts of several suppliers", async () => {
    const { items } = await listParts(
      db,
      query({ q: "ab123", supplier: [SEARCH_SUPPLIER, "other co"], limit: 200 }),
    );
    expect(items.map((item) => [item.supplier, item.partNumber]).sort()).toEqual([
      ["Other Co", "AB-123-X"],
      [SEARCH_SUPPLIER, "AB-123-X"],
      [SEARCH_SUPPLIER, "AB1234"],
      [SEARCH_SUPPLIER, "XAB123"],
    ]);
  });

  test("returns nothing for a supplier that doesn't exist", async () => {
    expect(await search("", ["No Such Supplier"])).toEqual([]);
  });
});

describe("listParts cursors", () => {
  const firstCursor = async (sort: PartSort, dir: SortDirection) => {
    const { nextCursor } = await listParts(db, query({ sort, dir, limit: 2 }));
    if (nextCursor === null) throw new Error("Expected a second page");
    return nextCursor;
  };
  const forge = (cursor: unknown) => Buffer.from(JSON.stringify(cursor)).toString("base64url");

  test.each([
    ["not base64url JSON", "not-a-cursor"],
    ["JSON of the wrong shape", forge({ hello: "world" })],
    ["a price that isn't money", forge({ sort: "price", dir: "asc", value: "1; drop", id: 1 })],
    [
      "a quantity that isn't a whole number",
      forge({ sort: "quantity", dir: "asc", value: 1.5, id: 1 }),
    ],
  ])("rejects %s", async (_, cursor) => {
    await expect(listParts(db, query({ sort: "price", cursor }))).rejects.toThrow(
      InvalidCursorError,
    );
    await expect(listParts(db, query({ sort: "quantity", cursor }))).rejects.toThrow(
      InvalidCursorError,
    );
  });

  test("rejects a cursor from a different sort", async () => {
    const cursor = await firstCursor("quantity", "asc");
    await expect(listParts(db, query({ sort: "price", cursor }))).rejects.toThrow(
      "different sort or direction",
    );
  });

  test("rejects a cursor from the other direction", async () => {
    const cursor = await firstCursor("lead_time", "asc");
    await expect(listParts(db, query({ sort: "lead_time", dir: "desc", cursor }))).rejects.toThrow(
      "different sort or direction",
    );
  });
});
