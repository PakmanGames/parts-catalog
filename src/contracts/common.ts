/**
 * Building blocks shared by the API contracts in PRD 7.4.
 *
 * Contracts are Zod schemas, and each exports a type of the same name inferred from it, so route
 * handlers validate with the schema and the UI imports the type.
 */
import { z } from "zod";

/**
 * Money is `numeric(MONEY_PRECISION, MONEY_SCALE)` in Postgres (PRD 7.1, `src/db/schema.ts`).
 * The data profile confirmed scale 2: every 4-decimal price in the export ends in `00` (P20).
 */
export const MONEY_PRECISION = 12;
export const MONEY_SCALE = 2;

const integerDigits = MONEY_PRECISION - MONEY_SCALE;

/**
 * Money sent by the client, as a non-negative decimal string such as "12.50" or "12.5" (NFR4, D11).
 * The bounds match the column, so an out-of-range price is rejected here as a 400 instead of
 * failing in the database.
 */
export const MoneyInput = z
  .string()
  .regex(new RegExp(`^(0|[1-9]\\d{0,${integerDigits - 1}})(\\.\\d{1,${MONEY_SCALE}})?$`), {
    error: `Must be a non-negative amount with at most ${MONEY_SCALE} decimal places, such as "12.50"`,
  });

/**
 * Money returned by the server, with exactly `MONEY_SCALE` decimal places, the way Postgres formats
 * `numeric`. It has no upper bound, because quote totals can exceed a single column's range.
 */
export const Money = z.string().regex(new RegExp(`^\\d+\\.\\d{${MONEY_SCALE}}$`));

/** A database id. Ids are `bigint` in Postgres; `z.int()` also rejects values beyond 2^53 - 1. */
export const Id = z.int().positive();

/** A UTC timestamp in ISO 8601, as `Date.prototype.toJSON` writes it. */
export const Timestamp = z.iso.datetime();

/** The body of every `400`, `404`, `409`, `413`, and `503` response. */
export const ErrorResponse = z.object({ error: z.string() });
export type ErrorResponse = z.infer<typeof ErrorResponse>;
