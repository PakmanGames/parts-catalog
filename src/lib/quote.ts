/**
 * The quote form's rules that don't need React: checking what the buyer typed against the
 * contract, warning about stock (A6, A19), and wording the server's errors.
 */
import { MoneyInput } from "@/contracts/common";
import type { Part } from "@/contracts/parts";
import { CreateQuoteLine } from "@/contracts/quotes";
import { formatCount, formatLeadTime } from "@/lib/format";

/** A quote line as typed: both fields stay strings until they pass the contract. */
export type LineDraft = { quantity: string; unitPrice: string };

/** A draft's values once valid, or the message to show for each field that isn't. */
export type CheckedLine =
  | { ok: true; quantity: number; unitPrice: string }
  | {
      ok: false;
      /** The quantity when it is valid, so the stock warning can still use it. */
      quantity: number | null;
      quantityError?: string;
      unitPriceError?: string;
    };

/** The default draft for a newly selected part: one unit at the part's price, or no price. */
export function newLineDraft(part: Part): LineDraft {
  return { quantity: "1", unitPrice: part.price ?? "" };
}

/** Checks a draft with the same rules the server applies to `CreateQuoteLine` (R3.2). */
export function checkLine(draft: LineDraft): CheckedLine {
  const quantityText = draft.quantity.trim();
  const unitPrice = draft.unitPrice.trim();

  let quantity: number | null = null;
  let quantityError: string | undefined;
  if (quantityText === "") {
    quantityError = "Enter a quantity";
  } else if (!/^\d+$/.test(quantityText)) {
    // Checked as text first, so "1e3" or "12." never silently becomes a different number.
    quantityError = "Quantity must be a whole number";
  } else {
    const parsed = CreateQuoteLine.shape.quantity.safeParse(Number(quantityText));
    if (parsed.success) {
      quantity = parsed.data;
    } else {
      quantityError = parsed.error.issues[0]?.message;
    }
  }

  let unitPriceError: string | undefined;
  if (unitPrice === "") {
    unitPriceError = "Enter a unit price";
  } else {
    const parsed = MoneyInput.safeParse(unitPrice);
    if (!parsed.success) {
      unitPriceError = parsed.error.issues[0]?.message;
    }
  }

  if (quantity !== null && unitPriceError === undefined) {
    return { ok: true, quantity, unitPrice };
  }
  return { ok: false, quantity, quantityError, unitPriceError };
}

/**
 * What the form says about a line's stock: the stock and lead time when the quantity is covered,
 * and a warning when it is above stock or the stock is unknown (A6, A19), such as
 * "80 more than in stock, lead time 21 days".
 */
export function stockNote(
  part: Pick<Part, "quantity" | "leadTimeDays">,
  quantity: number | null,
): { text: string; warning: boolean } {
  const leadTime =
    part.leadTimeDays === null
      ? "lead time unknown"
      : `lead time ${formatLeadTime(part.leadTimeDays)}`;
  if (part.quantity === null) {
    return { text: `Stock unknown, ${leadTime}`, warning: true };
  }
  if (quantity !== null && quantity > part.quantity) {
    return {
      text: `${formatCount(quantity - part.quantity)} more than in stock, ${leadTime}`,
      warning: true,
    };
  }
  return { text: `${formatCount(part.quantity)} in stock, ${leadTime}`, warning: false };
}

/**
 * Rewords a `400` message that points at a line by its JSON path, such as
 * "lines.0.partId: ...", to the line number the buyer sees, "Line 1: ...".
 */
export function describeSaveError(message: string): string {
  return message.replace(
    /^lines\.(\d+)\.\w+: /,
    (_, index: string) => `Line ${Number(index) + 1}: `,
  );
}
