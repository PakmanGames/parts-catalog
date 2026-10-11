import { describe, expect, test } from "vitest";
import { ImportStatusResponse } from "./imports";

const summary = {
  rowsRead: 1200000,
  duplicatesCollapsed: 54000,
  rejected: { "quantity is negative": 1197, "price is negative": 1150 },
  newestRejected: 113,
  inserted: 1000,
  updated: 25000,
  unchanged: 1117641,
  markedUnavailable: 300,
  madeAvailable: 12,
  durationMs: 70000,
};
const startedAt = "2026-10-10T22:00:00Z";
const finishedAt = "2026-10-10T22:01:10Z";

describe("ImportStatusResponse", () => {
  test("accepts the PRD 7.4 example", () => {
    const example = { status: "succeeded", startedAt, finishedAt, summary, error: null };
    expect(ImportStatusResponse.parse(example)).toEqual(example);
  });

  test.each([
    [
      "idle before any import",
      { status: "idle", startedAt: null, finishedAt: null, summary: null, error: null },
    ],
    ["running", { status: "running", startedAt, finishedAt: null, summary: null, error: null }],
    [
      "failed with an error",
      { status: "failed", startedAt, finishedAt, summary: null, error: "Not valid gzip" },
    ],
  ])("accepts %s", (_, value) => {
    expect(ImportStatusResponse.safeParse(value).success).toBe(true);
  });

  test.each([
    [
      "a success without a summary",
      { status: "succeeded", startedAt, finishedAt, summary: null, error: null },
    ],
    [
      "a failure without an error",
      { status: "failed", startedAt, finishedAt, summary: null, error: null },
    ],
    [
      "a running import that already has a summary",
      { status: "running", startedAt, finishedAt: null, summary, error: null },
    ],
    [
      "a reject reason that isn't in the list",
      {
        status: "succeeded",
        startedAt,
        finishedAt,
        summary: { ...summary, rejected: { "price is CALL": 1 } },
        error: null,
      },
    ],
    [
      "an unknown status",
      { status: "queued", startedAt: null, finishedAt: null, summary: null, error: null },
    ],
    [
      "a negative count",
      {
        status: "succeeded",
        startedAt,
        finishedAt,
        summary: { ...summary, inserted: -1 },
        error: null,
      },
    ],
  ])("rejects %s", (_, value) => {
    expect(ImportStatusResponse.safeParse(value).success).toBe(false);
  });
});
