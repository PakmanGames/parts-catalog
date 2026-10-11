import type { ImportStatusResponse } from "@/contracts/imports";
import { latestImport } from "@/server/importer/status";

/** `GET /api/imports/latest` (PRD 7.4): the status of the latest import since the server started. */
export function GET(): Response {
  return Response.json(latestImport() satisfies ImportStatusResponse);
}
