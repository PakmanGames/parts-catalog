/**
 * The upload and status routes' HTTP behavior, with the import itself replaced, so each status can be
 * held while the routes are checked. The real import is covered in src/server/importer.
 */
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ImportStatusResponse, type ImportSummary } from "@/contracts/imports";

// `after()` needs a request scope that a direct call doesn't have, so its callbacks are collected and
// run by the test.
const background: (() => Promise<void>)[] = [];
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => background.push(task) }));

const importCsv = vi.fn<(db: unknown, csv: AsyncIterable<Uint8Array>) => Promise<ImportSummary>>();
vi.mock("@/server/importer", () => ({ importCsv }));

const { POST } = await import("./route");
const { GET } = await import("./latest/route");

const summary: ImportSummary = {
  rowsRead: 2,
  duplicatesCollapsed: 0,
  rejected: {},
  newestRejected: 0,
  inserted: 2,
  updated: 0,
  unchanged: 0,
  markedUnavailable: 0,
  madeAvailable: 0,
  durationMs: 5,
};

const upload = (body: BodyInit | null, headers?: HeadersInit) =>
  POST(
    new Request("http://localhost/api/imports", {
      method: "POST",
      body,
      headers,
      duplex: "half",
    } as RequestInit),
  );
const latest = async () => ImportStatusResponse.parse(await GET().json());
const finishBackground = () => Promise.all(background.splice(0).map((task) => task()));

beforeEach(() => {
  (globalThis as { importStatus?: unknown }).importStatus = undefined;
  background.length = 0;
  importCsv.mockReset();
});

describe("GET /api/imports/latest", () => {
  test("is idle before any import", async () => {
    expect((await latest()).status).toBe("idle");
  });
});

describe("POST /api/imports", () => {
  test.each([
    ["an empty body", ""],
    ["a plain CSV", "Part Number,NSN\r\n"],
  ])("answers 400 for %s", async (_, body) => {
    const response = await upload(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "The upload isn't gzip-compressed." });
    expect(importCsv).not.toHaveBeenCalled();
  });

  test("answers 413 when Content-Length is over 100 MB, without reading the body", async () => {
    const response = await upload(gzipSync("x"), {
      "content-length": String(100 * 1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
  });

  test("answers 413 when a body without Content-Length passes 100 MB", async () => {
    const megabyte = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 101) controller.enqueue(megabyte);
        else controller.close();
      },
    });
    const response = await upload(body);
    expect(response.status).toBe(413);
    expect(sent).toBeLessThanOrEqual(102);
  });

  test("answers 202, runs the import in the background, and reports it when done", async () => {
    let finish: (value: ImportSummary) => void = () => {};
    importCsv.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    const response = await upload(gzipSync("Part Number\r\n"));
    expect(response.status).toBe(202);
    const running = ImportStatusResponse.parse(await response.json());
    expect(running).toMatchObject({ status: "running", finishedAt: null });
    expect(await latest()).toEqual(running);

    const second = await upload(gzipSync("Part Number\r\n"));
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "An import is already running." });

    const done = finishBackground();
    finish(summary);
    await done;
    expect(await latest()).toMatchObject({
      status: "succeeded",
      startedAt: running.startedAt,
      summary,
    });
    expect(importCsv).toHaveBeenCalledTimes(1);
  });

  test("hands the import the decompressed CSV", async () => {
    const received: string[] = [];
    importCsv.mockImplementation(async (_db, csv) => {
      for await (const chunk of csv) received.push(Buffer.from(chunk).toString());
      return summary;
    });
    await upload(gzipSync("Part Number,NSN\r\nAN6C35,\r\n"));
    await finishBackground();
    expect(received.join("")).toBe("Part Number,NSN\r\nAN6C35,\r\n");
  });

  test("reports a body that starts like gzip but is corrupt as a failed import", async () => {
    importCsv.mockImplementation(async (_db, csv) => {
      for await (const _chunk of csv) {
        // Reading is what surfaces the decompression error.
      }
      return summary;
    });
    const corrupt = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from("not really gzip")]);
    expect((await upload(corrupt)).status).toBe(202);
    await finishBackground();
    const status = await latest();
    expect(status.status).toBe("failed");
    expect(status.error).toMatch(/^The upload isn't valid gzip: /);
  });

  test("reports any other failure as a failed import with its message, and allows a new one", async () => {
    importCsv.mockRejectedValue(new Error("Another import is already running."));
    await upload(gzipSync("Part Number\r\n"));
    await finishBackground();
    expect(await latest()).toMatchObject({
      status: "failed",
      error: "Another import is already running.",
      summary: null,
    });

    importCsv.mockResolvedValue(summary);
    expect((await upload(gzipSync("Part Number\r\n"))).status).toBe(202);
  });
});
