/**
 * Quotes (PRD R3, 7.4): create, list, and read.
 *
 * Totals aren't stored: Postgres computes them from the lines in `numeric` every time a quote is read,
 * so they are exact and can never disagree with the lines (NFR4, PRD 7.1). Each line keeps its own
 * unit price, so later imports can't change a saved quote (R3.5, D9).
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { CreateQuoteRequest, QuoteListResponse, QuoteResponse } from "@/contracts/quotes";
import type { Db } from "@/db";
import { parts, quoteLines, quotes } from "@/db/schema";

/** A request that passes the contract but breaks a rule only the database can check (R3.2). */
export class QuoteRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteRejectedError";
  }
}

type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Saves a quote and its lines in one transaction, so a failed line leaves no quote behind, and
 * returns it as `GET /api/quotes/:id` would. Only the quote tables are written (R3.4).
 * Throws `QuoteRejectedError` for an unknown or unavailable part. A quantity above stock is fine (A6).
 */
export function createQuote(db: Db, request: CreateQuoteRequest): Promise<QuoteResponse> {
  return db.transaction(async (tx) => {
    const partIds = request.lines.map((line) => line.partId);
    // FOR SHARE stops an import from marking these parts unavailable between this check and the insert.
    const found = await tx
      .select({
        id: parts.id,
        partNumber: parts.partNumber,
        supplier: parts.supplier,
        unavailableSince: parts.unavailableSince,
      })
      .from(parts)
      .where(inArray(parts.id, partIds))
      .for("share");
    const byId = new Map(found.map((part) => [part.id, part]));
    for (const id of partIds) {
      const part = byId.get(id);
      if (!part) throw new QuoteRejectedError(`Part ${id} doesn't exist.`);
      if (part.unavailableSince) {
        throw new QuoteRejectedError(
          `Part ${part.partNumber} from ${part.supplier} is no longer available.`,
        );
      }
    }

    const [quote] = await tx
      .insert(quotes)
      .values({ customerName: request.customerName })
      .returning({ id: quotes.id });
    if (!quote) throw new Error("The quote wasn't inserted.");
    await tx
      .insert(quoteLines)
      .values(request.lines.map((line) => ({ quoteId: quote.id, ...line })));

    const saved = await readQuote(tx, quote.id);
    if (!saved) throw new Error("The quote wasn't found after inserting it.");
    return saved;
  });
}

/** `GET /api/quotes/:id`, or `null` when there is no such quote. */
export function getQuote(db: Db, id: number): Promise<QuoteResponse | null> {
  return readQuote(db, id);
}

/** `GET /api/quotes`: newest first, with no pagination (A12). */
export async function listQuotes(db: Db): Promise<QuoteListResponse> {
  const rows = await db
    .select({
      id: quotes.id,
      customerName: quotes.customerName,
      createdAt: quotes.createdAt,
      lineCount: sql<number>`count(*)::int`,
      total: lineTotalSum,
    })
    .from(quotes)
    .innerJoin(quoteLines, eq(quoteLines.quoteId, quotes.id))
    .groupBy(quotes.id)
    .orderBy(desc(quotes.createdAt), desc(quotes.id));
  return { items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) };
}

// numeric(12, 2) times an integer is numeric with scale 2, which pg returns as a string such as "125.00".
const lineTotal = sql<string>`${quoteLines.quantity} * ${quoteLines.unitPrice}`;
const lineTotalSum = sql<string>`sum(${quoteLines.quantity} * ${quoteLines.unitPrice})`;

async function readQuote(db: Executor, id: number): Promise<QuoteResponse | null> {
  const [quote] = await db
    .select({
      id: quotes.id,
      customerName: quotes.customerName,
      createdAt: quotes.createdAt,
      total: sql<string>`(SELECT ${lineTotalSum} FROM ${quoteLines} WHERE ${quoteLines.quoteId} = ${quotes.id})`,
    })
    .from(quotes)
    .where(eq(quotes.id, id));
  if (!quote) return null;

  // The part number and supplier come from `parts`: their keys never change for an id (D9).
  const lines = await db
    .select({
      partId: quoteLines.partId,
      partNumber: parts.partNumber,
      supplier: parts.supplier,
      quantity: quoteLines.quantity,
      unitPrice: quoteLines.unitPrice,
      lineTotal,
    })
    .from(quoteLines)
    .innerJoin(parts, eq(parts.id, quoteLines.partId))
    .where(eq(quoteLines.quoteId, id))
    .orderBy(parts.partNumberKey, parts.supplierKey, quoteLines.partId);

  return { ...quote, createdAt: quote.createdAt.toISOString(), lines };
}
