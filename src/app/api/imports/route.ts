import { createGunzip } from "node:zlib";
import { after } from "next/server";
import type { ErrorResponse } from "@/contracts/common";
import type { ImportStatusResponse } from "@/contracts/imports";
import { db } from "@/db";
import { importCsv } from "@/server/importer";
import { beginImport, failImport, finishImport, latestImport } from "@/server/importer/status";

/** Cloudflare's cap on a request body, which the gzipped export has to fit under (D10). */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * `POST /api/imports` (PRD 7.2, 7.4): receives the gzipped export, responds `202` with the running
 * status, and imports in the background, so the response comes well inside Cloudflare's 100 seconds.
 */
export async function POST(request: Request): Promise<Response> {
  // Checked before reading the body too, so a second upload isn't transferred only to be refused.
  if (latestImport().status === "running") return alreadyRunning();
  if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BYTES) return tooLarge();
  const body = await readBody(request);
  if (!body) return tooLarge();
  if (body[0] !== 0x1f || body[1] !== 0x8b) {
    return errorResponse(400, "The upload isn't gzip-compressed.");
  }
  const status = beginImport();
  if (!status) return alreadyRunning();
  after(() => runImport(body));
  return Response.json(status satisfies ImportStatusResponse, { status: 202 });
}

/** The whole body, or `null` once it passes the cap, even when no `Content-Length` was sent. */
async function readBody(request: Request): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength;
    if (size > MAX_UPLOAD_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks);
}

async function runImport(body: Buffer): Promise<void> {
  const csv = createGunzip();
  csv.end(body);
  try {
    finishImport(await importCsv(db, csv));
  } catch (error) {
    const { message, code } = error as Error & { code?: string };
    // zlib reports a corrupt or cut-off upload with codes such as Z_DATA_ERROR and Z_BUF_ERROR.
    failImport(code?.startsWith("Z_") ? `The upload isn't valid gzip: ${message}.` : message);
  }
}

function alreadyRunning(): Response {
  return errorResponse(409, "An import is already running.");
}

function tooLarge(): Response {
  return errorResponse(413, "The upload is over 100 MB.");
}

function errorResponse(status: number, error: string): Response {
  return Response.json({ error } satisfies ErrorResponse, { status });
}
