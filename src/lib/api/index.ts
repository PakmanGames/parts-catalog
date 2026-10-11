/**
 * The typed client for the JSON API in PRD 7.4, with one function per endpoint.
 *
 * Every response body is parsed with its Zod contract from `src/contracts/`, so pages can trust the
 * types they get. Every failure is an `Error` whose message can be shown to the buyer as it is; for
 * an error status it is the `error` text of the server's `ErrorResponse`.
 *
 * With `NEXT_PUBLIC_API_MOCKS=1`, requests go to the fake server in `./mocks` instead of the
 * network, until the real routes land (T2.1 deletes the mocks).
 */
import type { z } from "zod";
import { ErrorResponse } from "@/contracts/common";
import { ImportStatusResponse } from "@/contracts/imports";
import { QuoteListResponse, QuoteResponse } from "@/contracts/quotes";

/** An error status from the API, with the message from its `ErrorResponse` body. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function send(path: string, init: RequestInit): Promise<Response> {
  // Next.js inlines `NEXT_PUBLIC_` variables at build time, so without mocks this branch and the
  // mocks module are dropped from the bundle.
  if (process.env.NEXT_PUBLIC_API_MOCKS === "1") {
    const { mockFetch } = await import("./mocks");
    return mockFetch(path, init);
  }
  return fetch(path, init);
}

/** Parses a body as JSON, or returns `undefined` for a body that isn't JSON, such as a proxy's HTML error page. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function request<T>(schema: z.ZodType<T>, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    // `no-store`, so polling the import status never gets a cached answer.
    response = await send(path, { cache: "no-store", ...init });
  } catch (error) {
    if (init.signal?.aborted) {
      throw error;
    }
    throw new Error("Couldn't reach the server. Check your connection, then try again.", {
      cause: error,
    });
  }

  const body = parseJson(await response.text());
  if (!response.ok) {
    const parsed = ErrorResponse.safeParse(body);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error : `The server responded with status ${response.status}.`,
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // A contract violation is a bug in the server or the client, never something the buyer did.
    throw new Error(`The server sent an unexpected response to ${init.method ?? "GET"} ${path}.`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** `GET /api/imports/latest`: the status of the most recent import since the server started. */
export function getLatestImport(signal?: AbortSignal): Promise<ImportStatusResponse> {
  return request(ImportStatusResponse, "/api/imports/latest", { signal });
}

/**
 * `POST /api/imports`: uploads a gzip-compressed export and starts importing it in the background.
 * Rejects with an `ApiError` with status `409` while another import is running.
 */
export function startImport(gzipped: Blob): Promise<ImportStatusResponse> {
  return request(ImportStatusResponse, "/api/imports", {
    method: "POST",
    headers: { "Content-Type": "application/gzip" },
    body: gzipped,
  });
}

/** `GET /api/quotes`: every saved quote, newest first. */
export function listQuotes(signal?: AbortSignal): Promise<QuoteListResponse> {
  return request(QuoteListResponse, "/api/quotes", { signal });
}

/**
 * `GET /api/quotes/:id`, with the id as it appears in the page's URL.
 * Rejects with an `ApiError` with status `404` if there's no such quote.
 */
export function getQuote(id: string, signal?: AbortSignal): Promise<QuoteResponse> {
  return request(QuoteResponse, `/api/quotes/${encodeURIComponent(id)}`, { signal });
}
