import { describe, expect, test } from "vitest";
import { Part, readPartsQuery } from "./parts";

const read = (query: string) => readPartsQuery(new URLSearchParams(query));

describe("readPartsQuery", () => {
  test("defaults to the first 50 parts by part number", () => {
    expect(read("").data).toEqual({ supplier: [], sort: "part_number", dir: "asc", limit: 50 });
  });

  test("reads every parameter, keeping each repeated supplier (R2.4)", () => {
    const query =
      "q=ab+123&supplier=Acme+Supply&supplier=Globex&sort=lead_time&dir=desc&limit=200&cursor=c1";
    expect(read(query).data).toEqual({
      q: "ab 123",
      supplier: ["Acme Supply", "Globex"],
      sort: "lead_time",
      dir: "desc",
      limit: 200,
      cursor: "c1",
    });
  });

  test("leaves the search term as typed, for the server to normalize", () => {
    expect(read("q=%25_").data?.q).toBe("%_");
  });

  test.each([
    ["a limit of 0", "limit=0", "limit"],
    ["a limit over 200", "limit=201", "limit"],
    ["a fractional limit", "limit=1.5", "limit"],
    ["a limit that isn't a number", "limit=all", "limit"],
    ["an unknown sort", "sort=supplier", "sort"],
    ["an unknown direction", "dir=up", "dir"],
    ["an empty supplier", "supplier=", "supplier.0"],
    ["an empty cursor", "cursor=", "cursor"],
  ])("rejects %s", (_, query, path) => {
    const result = read(query);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([path]);
  });
});

describe("Part", () => {
  const part = {
    id: 7,
    partNumber: "RNC55H9852FM",
    supplier: "Bay Aero Components",
    quantity: null,
    price: null,
    leadTimeDays: null,
    lastUpdated: "2026-05-05T00:00:00.000Z",
    unavailableSince: null,
  };

  test("allows an unknown quantity, price, and lead time (A19)", () => {
    expect(Part.parse(part)).toEqual(part);
  });

  test("rejects a price that isn't formatted like Postgres numeric", () => {
    expect(Part.safeParse({ ...part, price: "18.1" }).success).toBe(false);
  });
});
