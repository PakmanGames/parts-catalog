/**
 * The status of the latest import in this server process (PRD 7.2, `GET /api/imports/latest`).
 *
 * It lives in memory, so a restart forgets it, which PRD D10 accepts: the transaction rolls back, and
 * the buyer uploads again. Route handlers can be bundled as separate module instances, so the status
 * is kept on `globalThis` for all of them to share.
 */
import type { ImportStatusResponse, ImportSummary } from "@/contracts/imports";

const store = globalThis as typeof globalThis & { importStatus?: ImportStatusResponse };

export function latestImport(): ImportStatusResponse {
  return (
    store.importStatus ?? {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      summary: null,
      error: null,
    }
  );
}

/**
 * Marks an import as running and returns its status, or returns `null` if one is already running.
 * Checking and setting happen in one synchronous step, so two requests can't both start an import.
 */
export function beginImport(): ImportStatusResponse | null {
  if (latestImport().status === "running") return null;
  store.importStatus = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    summary: null,
    error: null,
  };
  return store.importStatus;
}

export function finishImport(summary: ImportSummary): void {
  store.importStatus = {
    status: "succeeded",
    startedAt: startedAt(),
    finishedAt: new Date().toISOString(),
    summary,
    error: null,
  };
}

export function failImport(error: string): void {
  store.importStatus = {
    status: "failed",
    startedAt: startedAt(),
    finishedAt: new Date().toISOString(),
    summary: null,
    error,
  };
}

function startedAt(): string {
  const current = latestImport();
  if (current.status !== "running") throw new Error("No import is running.");
  return current.startedAt;
}
