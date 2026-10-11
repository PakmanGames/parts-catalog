import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, getQuote, listQuotes, startImport } from "./index";

const quotes = {
  items: [
    {
      id: 1,
      customerName: "Initech",
      createdAt: "2026-10-10T15:02:00Z",
      lineCount: 1,
      total: "125.00",
    },
  ],
};

/** Makes every `fetch` answer with `body` and `status`, and returns the mock to inspect calls. */
function respond(status: number, body: string, contentType = "application/json") {
  const fetch = vi.fn(
    async () => new Response(body, { status, headers: { "Content-Type": contentType } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client", () => {
  test("returns a body that matches its contract", async () => {
    respond(200, JSON.stringify(quotes));
    await expect(listQuotes()).resolves.toEqual(quotes);
  });

  test("rejects an error status with the message from its ErrorResponse", async () => {
    respond(409, JSON.stringify({ error: "An import is already running." }));
    const error = await startImport(new Blob()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: "An import is already running." });
  });

  test("still rejects an error status whose body isn't an ErrorResponse, such as a proxy's page", async () => {
    respond(502, "<html>Bad gateway</html>", "text/html");
    await expect(listQuotes()).rejects.toMatchObject({
      status: 502,
      message: "The server responded with status 502.",
    });
  });

  test("rejects a successful response that breaks its contract, without calling it an API error", async () => {
    respond(200, JSON.stringify({ items: [{ ...quotes.items[0], total: 125 }] }));
    const error = await listQuotes().catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: "The server sent an unexpected response to GET /api/quotes.",
    });
  });

  test("explains a network failure in words the buyer can act on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(listQuotes()).rejects.toThrow(
      "Couldn't reach the server. Check your connection, then try again.",
    );
  });

  test("passes an abort through unchanged, so callers can ignore it", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_: string, init: RequestInit) => Promise.reject(init.signal?.reason)),
    );
    await expect(listQuotes(controller.signal)).rejects.toBe(controller.signal.reason);
  });

  test("uploads the compressed export as a raw gzip body", async () => {
    const fetch = respond(
      202,
      JSON.stringify({
        status: "running",
        startedAt: "2026-10-10T22:00:00Z",
        finishedAt: null,
        summary: null,
        error: null,
      }),
    );
    const gzipped = new Blob([new Uint8Array([0x1f, 0x8b])]);
    await startImport(gzipped);
    expect(fetch).toHaveBeenCalledWith("/api/imports", {
      cache: "no-store",
      method: "POST",
      headers: { "Content-Type": "application/gzip" },
      body: gzipped,
    });
  });

  test("escapes the quote id from the URL into one path segment", async () => {
    const fetch = respond(404, JSON.stringify({ error: "Quote not found." }));
    await expect(getQuote("1/../2")).rejects.toMatchObject({ status: 404 });
    expect(fetch).toHaveBeenCalledWith("/api/quotes/1%2F..%2F2", expect.anything());
  });
});
