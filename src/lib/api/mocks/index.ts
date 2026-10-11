/**
 * A fake API server that runs in the browser, so the UI can be built before the real routes exist.
 * T2.1 deletes this folder when it connects the real API.
 *
 * It answers like the routes in PRD 7.4, with contract-valid bodies, the same status codes, and
 * `ErrorResponse` bodies, after a delay like a real request's. Its state lives in memory, so a full
 * page reload starts it over.
 *
 * To reach the cases that are hard to cause by hand, open any page with `?mock=<scenario>`.
 * The scenario lasts until the next full page load.
 *
 * - `slow`: every request takes 4 seconds, to see the loading states.
 * - `empty`: there are no saved quotes.
 * - `error`: every request fails with a `503`, as if the database were down.
 * - `import-conflict`: another import starts just before yours, so your upload gets a `409`.
 * - `import-fail`: the import runs, then fails.
 */
import type { ImportStatusResponse } from "@/contracts/imports";
import { QuoteIdParam, type QuoteListItem, type QuoteResponse } from "@/contracts/quotes";
import { IMPORT_DURATION_MS, NIGHTLY_SUMMARY, seedQuotes } from "./data";

/** The upload limit of `POST /api/imports`, from Cloudflare's request body cap (PRD D10). */
const MAX_UPLOAD_BYTES = 100_000_000;

type State = {
  scenario: string | null;
  latestImport: ImportStatusResponse;
  quotes: QuoteResponse[];
};

let state: State | undefined;

/** Created on the first request, because the scenario comes from the URL, which needs `window`. */
function getState(): State {
  if (!state) {
    const scenario = new URLSearchParams(window.location.search).get("mock");
    state = {
      scenario,
      latestImport: {
        status: "idle",
        startedAt: null,
        finishedAt: null,
        summary: null,
        error: null,
      },
      quotes: scenario === "empty" ? [] : seedQuotes(),
    };
  }
  return state;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(status: number, message: string): Response {
  return json(status, { error: message });
}

function delay(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function running(startedAt: number): ImportStatusResponse {
  return {
    status: "running",
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: null,
    summary: null,
    error: null,
  };
}

/** Finishes a running import once its time is up, so the status moves on without timers. */
function settleImport(s: State): void {
  if (s.latestImport.status !== "running") {
    return;
  }
  const startedAt = s.latestImport.startedAt;
  const finishedAt = Date.parse(startedAt) + IMPORT_DURATION_MS;
  if (Date.now() < finishedAt) {
    return;
  }
  const finished = { startedAt, finishedAt: new Date(finishedAt).toISOString() };
  s.latestImport =
    s.scenario === "import-fail"
      ? {
          status: "failed",
          ...finished,
          summary: null,
          error: "Lost the connection to the database while importing. The catalog is unchanged.",
        }
      : {
          status: "succeeded",
          ...finished,
          summary: { ...NIGHTLY_SUMMARY, durationMs: IMPORT_DURATION_MS },
          error: null,
        };
}

async function postImport(s: State, body: RequestInit["body"]): Promise<Response> {
  if (!(body instanceof Blob)) {
    return error(400, "The upload isn't gzip-compressed.");
  }
  if (body.size > MAX_UPLOAD_BYTES) {
    return error(413, "The upload is over 100 MB.");
  }
  const magic = new Uint8Array(await body.slice(0, 2).arrayBuffer());
  if (magic[0] !== 0x1f || magic[1] !== 0x8b) {
    return error(400, "The upload isn't gzip-compressed.");
  }
  if (s.scenario === "import-conflict" && s.latestImport.status === "idle") {
    // Someone else's import, such as `pnpm import:csv`, started a moment before this upload.
    s.latestImport = running(Date.now() - 2_000);
  }
  settleImport(s);
  if (s.latestImport.status === "running") {
    return error(409, "An import is already running.");
  }
  s.latestImport = running(Date.now());
  return json(202, s.latestImport);
}

function listQuotes(s: State): Response {
  const items: QuoteListItem[] = s.quotes
    .map(({ id, customerName, createdAt, lines, total }) => ({
      id,
      customerName,
      createdAt,
      lineCount: lines.length,
      total,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  return json(200, { items });
}

function getQuote(s: State, rawId: string): Response {
  const id = QuoteIdParam.safeParse(rawId);
  const found = id.success && s.quotes.find((quote) => quote.id === id.data);
  return found ? json(200, found) : error(404, "Quote not found.");
}

/** Answers a request for `path` the way the real API would. */
export async function mockFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const s = getState();
  const method = init.method ?? "GET";
  const isUpload = method === "POST" && path === "/api/imports";
  // An upload of the real file is about 36 MB, so it takes a moment longer than other requests.
  const ms = s.scenario === "slow" ? 4_000 : isUpload ? 1_500 : 250 + Math.random() * 400;
  await delay(ms, init.signal);

  if (s.scenario === "error") {
    return error(503, "Database unreachable: ECONNREFUSED");
  }
  if (isUpload) {
    return postImport(s, init.body);
  }
  if (method === "GET" && path === "/api/imports/latest") {
    settleImport(s);
    return json(200, s.latestImport);
  }
  if (method === "GET" && path === "/api/quotes") {
    return listQuotes(s);
  }
  const quoteId = /^\/api\/quotes\/([^/]+)$/.exec(path)?.[1];
  if (method === "GET" && quoteId !== undefined) {
    return getQuote(s, decodeURIComponent(quoteId));
  }
  return error(404, `No mock for ${method} ${path}.`);
}
