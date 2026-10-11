/** Contracts for creating and viewing quotes (PRD R3, 7.4). */
import { z } from "zod";
import { Id, Money, MoneyInput, Timestamp } from "./common";

/** The largest value of a Postgres `integer`, the type of `quote_lines.quantity`. */
const MAX_QUANTITY = 2_147_483_647;

/**
 * One line of a new quote. The unit price defaults to the part's price, and the buyer can edit it
 * (C6). The quantity may be more than the stock on hand (A6).
 */
export const CreateQuoteLine = z.object({
  partId: Id,
  quantity: z
    .int({ error: "Quantity must be a whole number" })
    .min(1, { error: "Quantity must be at least 1" })
    .max(MAX_QUANTITY, { error: `Quantity must be at most ${MAX_QUANTITY}` }),
  unitPrice: MoneyInput,
});
export type CreateQuoteLine = z.infer<typeof CreateQuoteLine>;

/**
 * `POST /api/quotes` body: every R3.2 rule that can be checked without the database.
 * The server still has to reject unknown parts and parts that are no longer available.
 */
export const CreateQuoteRequest = z.object({
  customerName: z.string().trim().min(1, { error: "Customer name is required" }),
  lines: z
    .array(CreateQuoteLine)
    .min(1, { error: "A quote needs at least one line" })
    .superRefine((lines, ctx) => {
      const seen = new Set<number>();
      for (const [index, { partId }] of lines.entries()) {
        if (seen.has(partId)) {
          ctx.addIssue({
            code: "custom",
            message: `Part ${partId} appears on more than one line`,
            path: [index, "partId"],
          });
        }
        seen.add(partId);
      }
    }),
});
export type CreateQuoteRequest = z.infer<typeof CreateQuoteRequest>;

/**
 * The `:id` in `GET /api/quotes/:id`, parsed from the URL.
 * Only canonical positive integers pass, so `042` and `1e3` fail, as do ids beyond 2^53 - 1,
 * which would lose precision as JavaScript numbers. No quote has an id that fails, so the route
 * answers `404`, the same as for a quote that doesn't exist (PRD 7.4).
 */
export const QuoteIdParam = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(Id);

/** A saved line. Part number and supplier come from `parts`, and the price is as saved (D9, R3.5). */
export const QuoteLine = z.object({
  partId: Id,
  partNumber: z.string(),
  supplier: z.string(),
  quantity: z.int().positive(),
  unitPrice: Money,
  lineTotal: Money,
});
export type QuoteLine = z.infer<typeof QuoteLine>;

/** `GET /api/quotes/:id`, which is also the `201` body of `POST /api/quotes`. */
export const QuoteResponse = z.object({
  id: Id,
  customerName: z.string(),
  createdAt: Timestamp,
  lines: z.array(QuoteLine).min(1),
  total: Money,
});
export type QuoteResponse = z.infer<typeof QuoteResponse>;

export const QuoteListItem = z.object({
  id: Id,
  customerName: z.string(),
  createdAt: Timestamp,
  lineCount: z.int().positive(),
  total: Money,
});
export type QuoteListItem = z.infer<typeof QuoteListItem>;

/** `GET /api/quotes`: newest first, with no pagination (A12). */
export const QuoteListResponse = z.object({ items: z.array(QuoteListItem) });
export type QuoteListResponse = z.infer<typeof QuoteListResponse>;
