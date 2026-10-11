/** Seed data for the mock API, shaped like the real export (`docs/data-profile.md`). */
import type { ImportSummary } from "@/contracts/imports";
import type { Part } from "@/contracts/parts";
import type { QuoteResponse } from "@/contracts/quotes";
import { lineTotalCents } from "@/lib/money";
import partsPage1 from "../../../../tests/fixtures/api/parts-page-1.json";
import partsPage2 from "../../../../tests/fixtures/api/parts-page-2.json";
import savedQuote from "../../../../tests/fixtures/api/quote.json";
import createdQuote from "../../../../tests/fixtures/api/quote-created.json";

/** How long a mock import runs before it finishes. */
export const IMPORT_DURATION_MS = 8_000;

/**
 * A nightly import of the full export: the data profile's line count and reject counts, with
 * plausible part counts that satisfy both sums documented on `ImportSummary`.
 */
export const NIGHTLY_SUMMARY: Omit<ImportSummary, "durationMs"> = {
  rowsRead: 1_203_487,
  duplicatesCollapsed: 44_163,
  rejected: {
    "row is empty": 605,
    "row has too few columns": 480,
    "row is a repeated header": 3,
    "part number is missing": 600,
    "quantity is negative": 1_197,
    "price is negative": 1_161,
    "last updated is missing": 10_902,
  },
  newestRejected: 113,
  inserted: 1_024,
  updated: 25_310,
  unchanged: 1_118_030,
  markedUnavailable: 318,
  madeAvailable: 12,
};

// `bigint` literals need an ES2020 target, and tsconfig.json targets ES2017.
const CENTS_PER_DOLLAR = BigInt(100);

/** Writes cents the way Postgres writes `numeric(12, 2)`, such as "125.00". */
export function toMoney(cents: bigint): string {
  return `${cents / CENTS_PER_DOLLAR}.${(cents % CENTS_PER_DOLLAR).toString().padStart(2, "0")}`;
}

type SeedLine = [
  partId: number,
  partNumber: string,
  supplier: string,
  quantity: number,
  unitPrice: string,
];

const HOUR_MS = 3_600_000;

function quote(
  id: number,
  customerName: string,
  hoursAgo: number,
  lines: SeedLine[],
): QuoteResponse {
  const priced = lines.map(([partId, partNumber, supplier, quantity, unitPrice]) => {
    const lineTotal = lineTotalCents(unitPrice, quantity);
    return { partId, partNumber, supplier, quantity, unitPrice, lineTotal };
  });
  return {
    id,
    customerName,
    createdAt: new Date(Date.now() - hoursAgo * HOUR_MS).toISOString(),
    lines: priced.map((line) => ({ ...line, lineTotal: toMoney(line.lineTotal) })),
    total: toMoney(priced.reduce((sum, line) => sum + line.lineTotal, BigInt(0))),
  };
}

/** A quote from `tests/fixtures/api/`, renumbered and redated so it sorts among the others. */
function fixture(id: number, hoursAgo: number, body: QuoteResponse): QuoteResponse {
  return { ...body, id, createdAt: new Date(Date.now() - hoursAgo * HOUR_MS).toISOString() };
}

/**
 * Saved quotes, oldest first, dated relative to now so a quote created in the mock is always
 * newest. Besides the two fixture quotes, they cover a long customer name, a quote with many lines,
 * a free line, the longest part number shape in the file (19 characters), and a total past
 * $10 million.
 */
export function seedQuotes(): QuoteResponse[] {
  return [
    quote(1, "Acme Aviation Services", 30 * 24, [
      [104_211, "NAS1149-500R", "Allied Fastener Supply", 400, "0.12"],
      [88_907, "MS21042L3", "Granite State Fasteners", 250, "0.48"],
    ]),
    quote(2, "Summit Charter Airlines", 12 * 24, [
      [530_118, "D38999/26WJ35SN", "Meridian Connector Corp", 6, "0"],
    ]),
    quote(3, "Tri-County Air Ambulance", 6 * 24, [
      [771_402, "RNC55H9852FM", "Cascade Aerospace Parts", 25_000, "1249.99"],
      [771_403, "JANTX2N5921", "Orion Microcircuits", 12_000, "86.40"],
    ]),
    quote(4, "Pacific Rim Aviation Services", 3 * 24, [
      [10_001, "AN960C10L", "Riverside Precision Bolt", 1_000, "0.06"],
      [10_002, "MS24693-C274", "Riverside Precision Bolt", 500, "0.19"],
      [10_003, "NAS1611-032A", "Pioneer Seal & Gasket", 120, "0.35"],
      [10_004, "M83248/2-390", "Keystone Bearing Co", 80, "1.10"],
      [10_005, "MS21045L176", "Allied Fastener Supply", 300, "0.22"],
      [10_006, "81H37815-5", "Frontier Turbine Parts", 2, "4318.00"],
      [10_007, "UN16492", "Northwind Hydraulics", 4, "212.75"],
      [10_008, "PH34161A", "Great Plains Hydraulics", 10, "38.20"],
      [10_009, "D38999/24JG62SC", "Meridian Connector Corp", 16, "54.90"],
      [10_010, "6036-2327-65", "Continental Hose Co", 40, "17.05"],
      [10_011, "M39029/58-360-0001", "Northstar Defense Logistics", 1_200, "0.94"],
      [10_012, "NAS1352N3-12", "Granite State Fasteners", 600, "0.31"],
      [10_013, "MS20995C32", "Ironclad Industrial Supply", 25, "11.60"],
      [10_014, "AS568-114", "Pioneer Seal & Gasket", 200, "0.18"],
    ]),
    quote(
      5,
      "Northern Lights Regional Airways, Maintenance, Repair and Overhaul Division (Hangar 4)",
      26,
      [[208_330, "M39029/58-360-0001", "Northstar Defense Logistics", 50, "0.94"]],
    ),
    fixture(6, 5, savedQuote),
    fixture(7, 2, createdQuote),
  ];
}

/** When the mock catalog's last import ran, matching the fixtures' `unavailableSince`. */
const IMPORTED_AT = "2026-10-11T02:00:05.000Z";

/** A small deterministic random generator (mulberry32), so the mock catalog is the same every load. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const PART_SHAPES = [
  "AN960C",
  "MS21042L",
  "NAS1149-",
  "MS24693-C",
  "M83248/1-",
  "AS568-",
  "MS28775-",
];
const LEAD_TIMES = [0, 7, 14, 21, 30, 45, 60, 84, 90, 120];

/**
 * The catalog: the 16 parts of the T0.3 fixtures, plus generated parts so that paging, search, and
 * the supplier filter have enough rows to work on. The generated parts mix in unknown values,
 * unavailable parts, the longest part number shape in the file (19 characters), and a supplier
 * name far longer than any in the file, to check the layout.
 */
export function seedParts(): Part[] {
  const fixtureParts = [...partsPage1.items, ...partsPage2.items];
  const suppliers = [
    ...new Set(fixtureParts.map((part) => part.supplier)),
    "Northstar Defense Logistics",
    "Consolidated Aerospace Hardware & Fittings Distribution Corporation",
  ];
  const random = seededRandom(7);
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)] as T;

  const generated = Array.from({ length: 150 }, (_, i): Part => {
    const unknown = random();
    return {
      id: 100 + i,
      partNumber:
        i === 0
          ? "M39029/58-360-00012"
          : `${PART_SHAPES[i % PART_SHAPES.length]}${100 + ((i * 37) % 900)}`,
      supplier: suppliers[i % suppliers.length] as string,
      quantity: unknown < 0.06 ? null : random() < 0.15 ? 0 : Math.floor(random() * 2_000),
      price: unknown > 0.95 ? null : (random() * 400).toFixed(2),
      leadTimeDays: unknown > 0.03 && unknown < 0.09 ? null : pick(LEAD_TIMES),
      lastUpdated: new Date(
        Date.UTC(2026, Math.floor(random() * 9), 1 + Math.floor(random() * 28)),
      ).toISOString(),
      unavailableSince: random() < 0.08 ? IMPORTED_AT : null,
    };
  });
  return [...fixtureParts, ...generated];
}
