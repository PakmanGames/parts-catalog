import type { ErrorResponse } from "@/contracts/common";
import { type PartsResponse, readPartsQuery } from "@/contracts/parts";
import { db } from "@/db";
import { InvalidCursorError, listParts } from "@/server/parts/list-parts";

/** `GET /api/parts` (PRD 7.4): one page of the catalog, searched, filtered, and sorted. */
export async function GET(request: Request) {
  const query = readPartsQuery(new URL(request.url).searchParams);
  if (!query.success) {
    const [issue] = query.error.issues;
    return badRequest(issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid query");
  }
  try {
    return Response.json((await listParts(db, query.data)) satisfies PartsResponse);
  } catch (error) {
    if (error instanceof InvalidCursorError) return badRequest(`cursor: ${error.message}`);
    throw error;
  }
}

function badRequest(error: string) {
  return Response.json({ error } satisfies ErrorResponse, { status: 400 });
}
