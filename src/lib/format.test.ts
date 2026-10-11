import { describe, expect, test } from "vitest";
import { formatCount, formatDate, formatDuration, formatLeadTime, formatMegabytes } from "./format";

describe("formatCount", () => {
  test.each([
    [0, "0"],
    [999, "999"],
    [1_203_487, "1,203,487"],
  ])("formats %d as %j", (value, formatted) => {
    expect(formatCount(value)).toBe(formatted);
  });
});

describe("formatDuration", () => {
  test.each([
    [0, "0.0 s"],
    [420, "0.4 s"],
    [9_949, "9.9 s"],
    [10_000, "10 s"],
    [42_400, "42 s"],
    [59_600, "1 min"],
    [70_000, "1 min 10 s"],
    [3_600_000, "60 min"],
  ])("formats %d ms as %j", (ms, formatted) => {
    expect(formatDuration(ms)).toBe(formatted);
  });
});

describe("formatMegabytes", () => {
  test.each([
    [36_123_456, "36.1 MB"],
    [100_000_000, "100.0 MB"],
    [104_857_600, "104.9 MB"],
  ])("formats %d bytes as %j", (bytes, formatted) => {
    expect(formatMegabytes(bytes)).toBe(formatted);
  });
});

describe("formatDate", () => {
  test.each([
    ["2026-03-18T00:00:00.000Z", "Mar 18, 2026"],
    ["2026-03-18T23:59:59Z", "Mar 18, 2026"],
    ["2027-01-01T00:00:00Z", "Jan 1, 2027"],
  ])("reads %j in UTC as %j, whatever the local time zone", (iso, formatted) => {
    expect(formatDate(iso)).toBe(formatted);
  });
});

describe("formatLeadTime", () => {
  test.each([
    [0, "0 days"],
    [1, "1 day"],
    [21, "21 days"],
    [1_500, "1,500 days"],
  ])("formats %d as %j", (days, formatted) => {
    expect(formatLeadTime(days)).toBe(formatted);
  });
});
