import type { ErrorResponse } from "@/contracts/common";
import { CreateQuoteRequest, type QuoteListResponse, type QuoteResponse } from "@/contracts/quotes";
import { db } from "@/db";
import { createQuote, listQuotes, QuoteRejectedError } from "@/server/quotes";

/** `GET /api/quotes` (PRD 7.4): every saved quote, newest first. */
export async function GET(): Promise<Response> {
  return Response.json((await listQuotes(db)) satisfies QuoteListResponse);
}

/** `POST /api/quotes` (PRD 7.4, R3.2): validates and saves a quote, answering `201` with it. */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("The request body isn't valid JSON.");
  }

  const parsed = CreateQuoteRequest.safeParse(body);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const path = issue?.path.map(String).join(".");
    return badRequest(path ? `${path}: ${issue?.message}` : (issue?.message ?? "Invalid quote."));
  }

  try {
    return Response.json((await createQuote(db, parsed.data)) satisfies QuoteResponse, {
      status: 201,
    });
  } catch (error) {
    if (error instanceof QuoteRejectedError) return badRequest(error.message);
    throw error;
  }
}

function badRequest(error: string): Response {
  return Response.json({ error } satisfies ErrorResponse, { status: 400 });
}
