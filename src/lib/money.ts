/**
 * Exact money arithmetic for the UI (NFR4).
 *
 * The API sends money as decimal strings. A JavaScript number can't hold most cent amounts exactly
 * (0.1 + 0.2 !== 0.3) and loses whole cents past 2^53, so amounts are converted to whole cents as
 * `bigint`, calculated on, and formatted straight from the `bigint`.
 */

// `bigint` literals such as `100n` need an ES2020 target, and tsconfig.json targets ES2017.
const CENTS_PER_DOLLAR = BigInt(100);

/** A non-negative amount with at most two decimal places, such as "12", "12.5", or "12.50". */
const AMOUNT = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Converts a decimal string such as "12.5" into whole cents (1250).
 * Throws a `RangeError` for anything that isn't a non-negative amount with at most two decimals,
 * so a malformed amount can never turn into a wrong total.
 */
export function toCents(amount: string): bigint {
  const match = AMOUNT.exec(amount);
  if (!match) {
    throw new RangeError(`Not a money amount: ${JSON.stringify(amount)}`);
  }
  const [, dollars = "", cents = ""] = match;
  return BigInt(dollars) * CENTS_PER_DOLLAR + BigInt(cents.padEnd(2, "0"));
}

/**
 * The exact total of `quantity` units at `unitPrice`, in cents.
 * Throws a `RangeError` if `quantity` isn't a whole number.
 */
export function lineTotalCents(unitPrice: string, quantity: number): bigint {
  return toCents(unitPrice) * BigInt(quantity);
}

/** Formats cents as US dollars, the only currency in the export (PRD Q8), such as "$1,234.50". */
export function formatCents(cents: bigint): string {
  const dollars = (cents / CENTS_PER_DOLLAR).toLocaleString("en-US");
  const rest = (cents % CENTS_PER_DOLLAR).toString().padStart(2, "0");
  return `$${dollars}.${rest}`;
}

/** Formats a decimal string from the API, such as "1234.5", as "$1,234.50". */
export function formatMoney(amount: string): string {
  return formatCents(toCents(amount));
}
