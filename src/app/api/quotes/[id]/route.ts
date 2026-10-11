import type { ErrorResponse } from "@/contracts/common";
import { QuoteIdParam, type QuoteResponse } from "@/contracts/quotes";
import { db } from "@/db";
import { getQuote } from "@/server/quotes";

/**
 * `GET /api/quotes/:id` (PRD 7.4). An id that isn't a positive integer can't belong to a quote, so it
 * gets the same `404` as a missing one.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/quotes/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  const parsed = QuoteIdParam.safeParse(id);
  const quote = parsed.success ? await getQuote(db, parsed.data) : null;
  if (!quote) {
    return Response.json({ error: `Quote ${id} doesn't exist.` } satisfies ErrorResponse, {
      status: 404,
    });
  }
  return Response.json(quote satisfies QuoteResponse);
}
