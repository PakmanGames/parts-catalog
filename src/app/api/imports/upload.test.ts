/**
 * Uploading a gzipped export through `POST /api/imports` with the real import, the way the import
 * panel will, and reading the result from `GET /api/imports/latest` (PRD R1.8).
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { expect, test, vi } from "vitest";
import { ImportStatusResponse } from "@/contracts/imports";
import { createTestDb } from "../../../../tests/db";

const testDb = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

// `after()` needs a request scope that a direct call doesn't have, so the test runs its callbacks.
const background: (() => Promise<void>)[] = [];
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => background.push(task) }));

const { POST } = await import("./route");
const { GET } = await import("./latest/route");

const fixtures = new URL("../../../../tests/fixtures/imports/", import.meta.url);
const expected = JSON.parse(readFileSync(new URL("expected.json", fixtures), "utf8")) as {
  steps: { file: string; summary: object }[];
};

// Steps 1 and 3 of tests/fixtures/imports/README.md: night 1 into an empty catalog, then night 2.
test.each([1, 3])(
  "uploading step %i's file returns 202, then reports its summary",
  async (stepNumber) => {
    const step = expected.steps[stepNumber - 1];
    if (!step) throw new Error("missing step");
    const body = gzipSync(readFileSync(new URL(step.file, fixtures)));
    const response = await POST(
      new Request("http://localhost/api/imports", { method: "POST", body }),
    );
    expect(response.status).toBe(202);

    await Promise.all(background.splice(0).map((task) => task()));
    const status = ImportStatusResponse.parse(await GET().json());
    expect(status.status).toBe("succeeded");
    const { durationMs: _, ...summary } = status.summary ?? { durationMs: 0 };
    expect(summary).toEqual(step.summary);
  },
);
