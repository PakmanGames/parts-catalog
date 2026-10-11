/**
 * The whole import, from CSV bytes to the catalog, run over the T0.3 fixtures in the order
 * tests/fixtures/imports/README.md describes, against the summary and table expected after each step.
 */
import { createReadStream, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parts } from "@/db/schema";
import { createTestDb } from "../../../tests/db";
import { importCsv } from ".";

const db = await createTestDb();
const fixtures = new URL("../../../tests/fixtures/imports/", import.meta.url);
const expected = JSON.parse(readFileSync(new URL("expected.json", fixtures), "utf8")) as {
  steps: { file: string; summary: object; parts: object[] }[];
};

test("each import step produces exactly the expected summary and parts table", async () => {
  // unavailable_since is the time of the import that set it, so each new value names its step.
  const stepSetting = new Map<number, number>();
  for (const [index, step] of expected.steps.entries()) {
    const { durationMs, ...summary } = await importCsv(
      db,
      createReadStream(new URL(step.file, fixtures)),
    );
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(summary, `step ${index + 1} summary`).toEqual(step.summary);

    const table = await db.select().from(parts).orderBy(parts.supplierKey, parts.partNumberKey);
    for (const { unavailableSince } of table) {
      const time = unavailableSince?.getTime();
      if (time !== undefined && !stepSetting.has(time)) stepSetting.set(time, index + 1);
    }
    const actual = table.map(({ id: _id, unavailableSince, lastUpdated, ...part }) => ({
      ...part,
      lastUpdated: lastUpdated.toISOString(),
      unavailableSinceStep: unavailableSince ? stepSetting.get(unavailableSince.getTime()) : null,
    }));
    expect(actual, `step ${index + 1} parts`).toEqual(step.parts);
  }
});
