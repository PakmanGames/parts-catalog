/**
 * The normalizer (PRD 7.2, step 1): turns the fields of one CSV record into a `NormalizedRow`.
 *
 * The rules are the steps of `docs/data-profile.md` section 4.2, with the changes marked (T0.3)
 * there: Description and NSN are dropped (D20), an unknown quantity, price, or lead time becomes
 * `null` (A19), and a row rejected only for a bad value still carries its part (A17).
 */
import { MONEY_PRECISION, MONEY_SCALE } from "@/contracts/common";
import type { NormalizedRow, RejectedRow, RejectReason } from "@/contracts/import-rows";

const HEADER = [
  "Part Number",
  "NSN",
  "Description",
  "Supplier",
  "Qty On Hand",
  "Unit Price",
  "Lead Time",
  "Last Updated",
];

/** The largest Postgres `integer`, the column type of quantity and lead time. */
const MAX_INTEGER = 2_147_483_647;

// Compiled once, since they run on every row of a 1.2M-row file.
/** Once upper-cased, a value with none of these is empty under SQL `normalize_key`. */
const KEY_CHARACTER = /[A-Z0-9]/;
const WHITESPACE_RUN = /\s+/g;
const NEGATIVE = /^-\d/;
const THOUSANDS = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
const WHOLE = /^(\d+)(?:\.0+)?$/;
const DOLLAR = /^\$/;
const USD = /\s*USD$/i;
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;
const TRAILING_ZEROS = /0+$/;
const LEADING_ZEROS = /^0+(?=\d)/;
/** A number of days (`90`, `90 days`, `56d`) or, when group 2 matches, weeks (`3 wks`, `12 weeks`). */
const LEAD_TIME = /^(\d+)(?: ?(?:d|days?|(wks?|weeks?)))?$/i;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})Z)?$/;
const US_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** A field's value, or the reason it rejects the row. */
type Parsed<T> = { value: T } | { reason: RejectReason };

/** True when the fields are the export's header row. */
export function isHeader(fields: string[]): boolean {
  return fields.length === HEADER.length && fields.every((field, i) => field.trim() === HEADER[i]);
}

/**
 * Normalizes the fields of the CSV record that starts on line `lineNumber`.
 * A rejected row gets the reason of its first failing check, in the order of `REJECT_REASONS`.
 */
export function normalizeRow(lineNumber: number, fields: string[]): NormalizedRow {
  const reject = (
    reason: RejectReason,
    identity: RejectedRow["identity"] = null,
  ): NormalizedRow => ({
    outcome: "rejected",
    lineNumber,
    reason,
    identity,
  });

  if (fields.every((field) => field.trim() === "")) return reject("row is empty");
  if (fields.length < HEADER.length) return reject("row has too few columns");
  if (isHeader(fields)) return reject("row is a repeated header");

  // Only Description ever contains an unquoted comma, so the value columns are always the last five
  // fields, and anything between NSN and Supplier is Description (P5).
  const [partNumberField = ""] = fields;
  const [
    supplierField = "",
    quantityField = "",
    priceField = "",
    leadTimeField = "",
    lastUpdatedField = "",
  ] = fields.slice(-5);

  const partNumber = partNumberField.trim().toUpperCase();
  if (partNumber === "") return reject("part number is missing");
  if (!KEY_CHARACTER.test(partNumber)) return reject("part number has no letters or digits");

  const supplier = supplierField.trim().replace(WHITESPACE_RUN, " ");
  if (supplier === "") return reject("supplier is missing");
  if (!KEY_CHARACTER.test(supplier.toUpperCase())) {
    return reject("supplier has no letters or digits");
  }

  // Read before the values are checked, because a row rejected for a bad value still carries its
  // part and timestamp, so the loader can tell when a part's newest row is unusable (A17).
  const lastUpdatedText = lastUpdatedField.trim();
  const lastUpdated = lastUpdatedText === "" ? null : parseDate(lastUpdatedText);
  const rejectValue = (reason: RejectReason) =>
    reject(reason, lastUpdated && { partNumber, supplier, lastUpdated });

  const quantity = parseQuantity(quantityField.trim());
  if ("reason" in quantity) return rejectValue(quantity.reason);
  const price = parsePrice(priceField.trim());
  if ("reason" in price) return rejectValue(price.reason);
  const leadTimeDays = parseLeadTime(leadTimeField.trim());
  if ("reason" in leadTimeDays) return rejectValue(leadTimeDays.reason);

  if (lastUpdatedText === "") return reject("last updated is missing");
  if (!lastUpdated) return reject("last updated is not a valid date");

  return {
    outcome: "accepted",
    lineNumber,
    partNumber,
    supplier,
    quantity: quantity.value,
    price: price.value,
    leadTimeDays: leadTimeDays.value,
    lastUpdated,
  };
}

function parseQuantity(text: string): Parsed<number | null> {
  if (text === "" || text.toUpperCase() === "N/A") return { value: null };
  if (NEGATIVE.test(text)) return { reason: "quantity is negative" };
  // Thousands separators (P12) and a fraction of only zeros (P13) don't change the value.
  const whole = WHOLE.exec(THOUSANDS.test(text) ? text.replaceAll(",", "") : text);
  if (!whole) return { reason: "quantity is not a whole number" };
  const quantity = Number(whole[1]);
  if (quantity > MAX_INTEGER) return { reason: "quantity is too large" };
  return { value: quantity };
}

/**
 * Reads a price as an exact decimal string with two decimals, such as `"18.10"`, without ever
 * converting it to a number (NFR4).
 */
function parsePrice(text: string): Parsed<string | null> {
  if (text === "" || text.toUpperCase() === "CALL") return { value: null };
  // Every price is in US dollars, so the currency marks carry no information (P17, P18).
  const amount = text.replace(DOLLAR, "").replace(USD, "").trim();
  if (NEGATIVE.test(amount)) return { reason: "price is negative" };
  const parts = DECIMAL.exec(THOUSANDS.test(amount) ? amount.replaceAll(",", "") : amount);
  if (!parts) return { reason: "price is not a number" };
  const [, digits = "", decimals = ""] = parts;
  // Trailing zeros don't change the value (P20), but any other digit past the column's scale would
  // need rounding, which would be a guess.
  const fraction = decimals.replace(TRAILING_ZEROS, "");
  if (fraction.length > MONEY_SCALE) return { reason: "price has more than 2 decimal places" };
  const whole = digits.replace(LEADING_ZEROS, "");
  if (whole.length > MONEY_PRECISION - MONEY_SCALE) return { reason: "price is too large" };
  return { value: `${whole}.${fraction.padEnd(MONEY_SCALE, "0")}` };
}

function parseLeadTime(text: string): Parsed<number | null> {
  const upper = text.toUpperCase();
  if (upper === "" || upper === "TBD") return { value: null };
  // `STOCK` is how the export writes a lead time of 0 days (profile, "Why STOCK means 0 days").
  if (upper === "STOCK") return { value: 0 };
  const match = LEAD_TIME.exec(text);
  if (!match) return { reason: "lead time is not a number of days or weeks" };
  const [, count, weeks] = match;
  const days = Number(count) * (weeks ? 7 : 1);
  if (days > MAX_INTEGER) return { reason: "lead time is too large" };
  return { value: days };
}

/**
 * Reads `YYYY-MM-DD` and `MM/DD/YYYY` as midnight UTC, and `YYYY-MM-DDTHH:MM:SSZ` as that instant.
 * UTC keeps re-runs deterministic, whatever the server's time zone (profile, "Why UTC").
 */
function parseDate(text: string): Date | null {
  const us = US_DATE.exec(text);
  const match = us ? [text, us[3], us[1], us[2]] : ISO_DATE_TIME.exec(text);
  if (!match) return null;
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );
  // Date.UTC rolls out-of-range parts over, turning 02/30/2025 into March 2, so a date that doesn't
  // exist reads back as a different one.
  const readBack = date.toISOString().slice(0, 19);
  return readBack === `${year}-${month}-${day}T${hour}:${minute}:${second}` ? date : null;
}
