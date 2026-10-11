/**
 * A fake API server that runs in the browser, so the UI can be built before the real routes exist.
 * T2.1 deletes this folder when it connects the real API.
 *
 * It answers like the routes in PRD 7.4, with contract-valid bodies, the same status codes, and
 * the error messages of the fixtures in `tests/fixtures/api/`, after a delay like a real request's.
 * Its state lives in memory, so a full page reload starts it over.
 *
 * To reach the cases that are hard to cause by hand, open any page with `?mock=<scenario>`.
 * The scenario lasts until the next full page load.
 *
 * - `slow`: every request takes 4 seconds, to see the loading states.
 * - `empty`: the catalog has no parts and there are no saved quotes, as before the first import.
 * - `error`: every request fails with a `503`, as if the database were down.
 * - `import-conflict`: another import starts just before yours, so your upload gets a `409`.
 * - `import-fail`: the import runs, then fails.
 */
import type { ImportStatusResponse } from "@/contracts/imports";
import { type Part, type PartSort, readPartsQuery } from "@/contracts/parts";
import {
  CreateQuoteRequest,
  QuoteIdParam,
  type QuoteListItem,
  type QuoteResponse,
} from "@/contracts/quotes";
import { lineTotalCents, toCents } from "@/lib/money";
import error409 from "../../../../tests/fixtures/api/error-409.json";
import error413 from "../../../../tests/fixtures/api/error-413.json";
import error503 from "../../../../tests/fixtures/api/error-503.json";
import importFailed from "../../../../tests/fixtures/api/import-failed.json";
import { IMPORT_DURATION_MS, NIGHTLY_SUMMARY, seedParts, seedQuotes, toMoney } from "./data";

/** The upload limit of `POST /api/imports`, from Cloudflare's request body cap (PRD D10). */
const MAX_UPLOAD_BYTES = 100_000_000;

type State = {
  scenario: string | null;
  latestImport: ImportStatusResponse;
  parts: Part[];
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
      parts: scenario === "empty" ? [] : seedParts(),
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
  if (s.scenario === "import-fail") {
    s.latestImport = { status: "failed", ...finished, summary: null, error: importFailed.error };
    return;
  }
  s.latestImport = {
    status: "succeeded",
    ...finished,
    summary: { ...NIGHTLY_SUMMARY, durationMs: IMPORT_DURATION_MS },
    error: null,
  };
  // Like a real nightly file, one part comes back and another drops out, so the parts table
  // visibly changes when it reloads after the import.
  s.parts = s.parts.map((part) => {
    if (part.id === 3) {
      return { ...part, unavailableSince: null };
    }
    if (part.id === 1 && part.unavailableSince === null) {
      return { ...part, unavailableSince: finished.finishedAt };
    }
    return part;
  });
}

async function postImport(s: State, body: RequestInit["body"]): Promise<Response> {
  if (!(body instanceof Blob)) {
    return error(400, "The upload isn't valid gzip.");
  }
  if (body.size > MAX_UPLOAD_BYTES) {
    return json(413, error413);
  }
  const magic = new Uint8Array(await body.slice(0, 2).arrayBuffer());
  if (magic[0] !== 0x1f || magic[1] !== 0x8b) {
    return error(400, "The upload isn't valid gzip.");
  }
  if (s.scenario === "import-conflict" && s.latestImport.status === "idle") {
    // Someone else's import, such as `pnpm import:csv`, started a moment before this upload.
    s.latestImport = running(Date.now() - 2_000);
  }
  settleImport(s);
  if (s.latestImport.status === "running") {
    return json(409, error409);
  }
  s.latestImport = running(Date.now());
  return json(202, s.latestImport);
}

/** The same rule as the SQL `normalize_key`, which search, filtering, and sorting all use (D13). */
function normalizeKey(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const SORT_VALUE: Record<PartSort, (part: Part) => string | number | bigint | null> = {
  part_number: (part) => normalizeKey(part.partNumber),
  quantity: (part) => part.quantity,
  price: (part) => (part.price === null ? null : toCents(part.price)),
  lead_time: (part) => part.leadTimeDays,
};

/** Orders by the sort column, then by id in the same direction, with unknown values last (R2.2). */
function compareParts(sort: PartSort, desc: boolean) {
  const value = SORT_VALUE[sort];
  return (a: Part, b: Part) => {
    const x = value(a);
    const y = value(b);
    if (x === null || y === null) {
      if (x !== y) {
        return x === null ? 1 : -1;
      }
    } else if (x !== y) {
      return (x < y ? -1 : 1) * (desc ? -1 : 1);
    }
    return (a.id - b.id) * (desc ? -1 : 1);
  };
}

const CURSOR = /^mock-cursor-(\d+)$/;

/** The cursor is an offset here; the real API's is a keyset position, but both are opaque. */
function listParts(s: State, params: URLSearchParams): Response {
  const query = readPartsQuery(params);
  if (!query.success) {
    const [issue] = query.error.issues;
    return error(400, `${issue?.path.join(".")}: ${issue?.message}`);
  }
  const { q, supplier, sort, dir, limit, cursor } = query.data;
  const offset = cursor === undefined ? 0 : Number(CURSOR.exec(cursor)?.[1] ?? Number.NaN);
  if (Number.isNaN(offset)) {
    return error(400, "cursor: The cursor isn't valid.");
  }
  const term = normalizeKey(q ?? "");
  const suppliers = new Set(supplier.map(normalizeKey));
  const matches = s.parts
    .filter(
      (part) =>
        normalizeKey(part.partNumber).includes(term) &&
        (suppliers.size === 0 || suppliers.has(normalizeKey(part.supplier))),
    )
    .sort(compareParts(sort, dir === "desc"));
  const end = offset + limit;
  return json(200, {
    items: matches.slice(offset, end),
    nextCursor: end < matches.length ? `mock-cursor-${end}` : null,
  });
}

function listSuppliers(s: State): Response {
  const items = [...new Set(s.parts.map((part) => part.supplier))].sort((a, b) =>
    a.localeCompare(b),
  );
  return json(200, { items });
}

function postQuote(s: State, body: RequestInit["body"]): Response {
  let input: unknown;
  try {
    input = JSON.parse(String(body));
  } catch {
    return error(400, "The request body isn't valid JSON.");
  }
  const request = CreateQuoteRequest.safeParse(input);
  if (!request.success) {
    const [issue] = request.error.issues;
    return error(400, `${issue?.path.join(".")}: ${issue?.message}`);
  }
  const lines = [];
  for (const [index, line] of request.data.lines.entries()) {
    const part = s.parts.find((candidate) => candidate.id === line.partId);
    if (!part) {
      return error(400, `lines.${index}.partId: Part ${line.partId} doesn't exist.`);
    }
    if (part.unavailableSince !== null) {
      return error(
        400,
        `lines.${index}.partId: ${part.partNumber} from ${part.supplier} is no longer available.`,
      );
    }
    lines.push({
      partId: part.id,
      partNumber: part.partNumber,
      supplier: part.supplier,
      quantity: line.quantity,
      unitPrice: toMoney(toCents(line.unitPrice)),
      lineTotal: lineTotalCents(line.unitPrice, line.quantity),
    });
  }
  const quote: QuoteResponse = {
    id: Math.max(0, ...s.quotes.map((saved) => saved.id)) + 1,
    customerName: request.data.customerName,
    createdAt: new Date().toISOString(),
    lines: lines.map((line) => ({ ...line, lineTotal: toMoney(line.lineTotal) })),
    total: toMoney(lines.reduce((sum, line) => sum + line.lineTotal, BigInt(0))),
  };
  s.quotes.push(quote);
  return json(201, quote);
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
  return found ? json(200, found) : error(404, `Quote ${rawId} doesn't exist.`);
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
    return json(503, error503);
  }
  if (isUpload) {
    return postImport(s, init.body);
  }
  if (method === "GET" && path === "/api/imports/latest") {
    settleImport(s);
    return json(200, s.latestImport);
  }
  const url = new URL(path, window.location.origin);
  if (method === "GET" && url.pathname === "/api/parts") {
    return listParts(s, url.searchParams);
  }
  if (method === "GET" && path === "/api/suppliers") {
    return listSuppliers(s);
  }
  if (method === "POST" && path === "/api/quotes") {
    return postQuote(s, init.body);
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
