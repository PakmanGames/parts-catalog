import { expect, test } from "vitest";
import { parts } from "@/db/schema";
import { createTestDb } from "../../../tests/db";
import { listSuppliers } from "./list-suppliers";

const db = await createTestDb();

const part = (
  supplier: string,
  partNumber: string,
  lastUpdated: string,
  unavailableSince: Date | null = null,
) => ({ supplier, partNumber, lastUpdated: new Date(lastUpdated), unavailableSince });
const GONE = new Date("2026-10-11T02:00:00Z");

test("returns no suppliers for an empty catalog", async () => {
  expect(await listSuppliers(db)).toEqual({ items: [] });
});

test("lists each supplier once, by its available spelling, sorted by name", async () => {
  await db.insert(parts).values([
    part("Westbrook Seals", "AS568-218", "2026-09-01"),
    part("Westbrook Seals", "AS568-219", "2026-09-02"),
    // A newer row of an unavailable part keeps an older spelling, which must not win (7.3).
    part("WESTBROOK SEALS.", "AS568-220", "2026-10-01", GONE),
    part("Allied Fastener Supply", "MS21045L176", "2026-09-01"),
    // With no available parts, the spelling on the newest row wins.
    part("anchor fluid power", "6036-2327-65", "2026-08-01", GONE),
    part("Anchor Fluid Power", "6036-2327-66", "2026-09-15", GONE),
    part("ANCHOR FLUID POWER", "6036-2327-67", "2026-07-01", GONE),
  ]);
  expect(await listSuppliers(db)).toEqual({
    items: ["Allied Fastener Supply", "Anchor Fluid Power", "Westbrook Seals"],
  });
});
