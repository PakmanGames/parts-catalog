/** Seed data for the mock API, shaped like the real export (`docs/data-profile.md`). */
import type { ImportSummary } from "@/contracts/imports";
import type { QuoteResponse } from "@/contracts/quotes";
import { lineTotalCents } from "@/lib/money";

/** How long a mock import runs before it finishes. */
export const IMPORT_DURATION_MS = 8_000;

/**
 * A nightly import of the full export: the data profile's line count and identity and date
 * rejections, with plausible part counts. Accepted rows minus distinct parts is
 * `duplicatesCollapsed`, and inserted, updated, and unchanged add up to the parts in the file.
 */
export const NIGHTLY_SUMMARY: Omit<ImportSummary, "durationMs"> = {
  rowsRead: 1_203_487,
  duplicatesCollapsed: 56_351,
  rejected: {
    "row is empty": 605,
    "row has too few columns": 480,
    "row is a repeated header": 3,
    "part number is missing": 600,
    "last updated is missing": 10_902,
  },
  inserted: 1_024,
  updated: 25_310,
  unchanged: 1_108_212,
  markedUnavailable: 318,
  madeAvailable: 12,
};

// `bigint` literals need an ES2020 target, and tsconfig.json targets ES2017.
const CENTS_PER_DOLLAR = BigInt(100);

/** Writes cents the way Postgres writes `numeric(12, 2)`, such as "125.00". */
function toMoney(cents: bigint): string {
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

/**
 * Saved quotes, oldest first. They cover a long customer name, a quote with many lines, a free
 * line, the longest part number shape in the file (19 characters), and a total past $10 million.
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
    quote(4, "Globex Corporation", 3 * 24, [
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
    quote(6, "Initech", 2, [
      [42, "RNC55H9852FM", "Bay Aero Components", 10, "12.50"],
      [43, "NAS1149-500R", "Highland Electrical Supply", 80, "18.10"],
      [44, "MS21042L3", "Copperline Electronics", 3, "7.05"],
    ]),
  ];
}
