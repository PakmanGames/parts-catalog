"use client";

import { CircleAlert, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { Part } from "@/contracts/parts";
import { CreateQuoteRequest } from "@/contracts/quotes";
import { clearSelection, deselectPart, useSelection } from "@/hooks/use-selection";
import { createQuote } from "@/lib/api";
import { formatCents, lineTotalCents } from "@/lib/money";
import {
  type CheckedLine,
  checkLine,
  describeSaveError,
  type LineDraft,
  newLineDraft,
  stockNote,
} from "@/lib/quote";
import { cn, toError } from "@/lib/utils";

/**
 * The quote form (PRD R3.2, 7.5): a customer name and one line per selected part, with live line
 * totals and quote total, stock warnings, and Save. Each line starts at the part's price from the
 * selection; a part with an unknown price starts empty, and the buyer has to enter one (A19).
 */
export function QuoteForm() {
  const id = useId();
  const router = useRouter();
  const selected = useSelection();
  const [customerName, setCustomerName] = useState("");
  const [drafts, setDrafts] = useState<Record<number, LineDraft>>({});
  // Field errors appear after the first Save, then follow what the buyer types.
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  if (savedId !== null) {
    return <p className="text-sm text-muted-foreground">Quote {savedId} saved. Opening it…</p>;
  }
  if (selected === null) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (selected.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
        <p className="font-medium">No parts selected</p>
        <p className="text-sm text-muted-foreground">
          Select parts on the Parts page, then come back to quote them.
        </p>
        <Link href="/parts" className={cn(buttonVariants({ variant: "outline" }))}>
          Go to Parts
        </Link>
      </div>
    );
  }

  const lines = selected.map((part) => {
    const draft = drafts[part.id] ?? newLineDraft(part);
    return { part, draft, checked: checkLine(draft) };
  });
  const customerError =
    CreateQuoteRequest.shape.customerName.safeParse(customerName).error?.issues[0]?.message;
  const total = lines.every((line) => line.checked.ok)
    ? lines.reduce(
        (sum, { checked }) =>
          checked.ok ? sum + lineTotalCents(checked.unitPrice, checked.quantity) : sum,
        BigInt(0),
      )
    : null;

  function updateDraft(part: Part, change: Partial<LineDraft>) {
    setDrafts((current) => ({
      ...current,
      [part.id]: { ...(current[part.id] ?? newLineDraft(part)), ...change },
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setSaveError(null);

    const firstInvalid =
      customerError !== undefined
        ? `${id}-customer`
        : lines
            .filter(({ checked }) => !checked.ok)
            .map(({ part, checked }) =>
              !checked.ok && checked.quantityError
                ? `${id}-quantity-${part.id}`
                : `${id}-price-${part.id}`,
            )[0];
    if (firstInvalid !== undefined) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }

    setSaving(true);
    try {
      const quote = await createQuote({
        customerName,
        lines: lines.map(({ part, checked }) => ({
          partId: part.id,
          quantity: checked.ok ? checked.quantity : 0,
          unitPrice: checked.ok ? checked.unitPrice : "",
        })),
      });
      setSavedId(quote.id);
      clearSelection();
      router.push(`/quotes/${quote.id}`);
    } catch (error) {
      setSaveError(describeSaveError(toError(error).message));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div className="grid max-w-md gap-1.5">
        <Label htmlFor={`${id}-customer`}>Customer</Label>
        <Input
          id={`${id}-customer`}
          value={customerName}
          onChange={(event) => setCustomerName(event.target.value)}
          autoComplete="organization"
          aria-invalid={submitted && customerError !== undefined}
          aria-describedby={submitted && customerError ? `${id}-customer-error` : undefined}
        />
        {submitted && customerError && (
          <p id={`${id}-customer-error`} className="text-xs text-destructive">
            {customerError}
          </p>
        )}
      </div>

      <section aria-labelledby={`${id}-lines`} className="flex flex-col">
        <h2 id={`${id}-lines`} className="mb-2 text-sm font-medium">
          Lines ({lines.length})
        </h2>
        <div
          aria-hidden
          className="hidden grid-cols-[minmax(0,1fr)_7rem_9rem_9rem_2rem] gap-x-4 border-b pb-2 text-sm font-medium md:grid"
        >
          <span>Part</span>
          <span>Quantity</span>
          <span>Unit price</span>
          <span className="text-right">Line total</span>
        </div>
        <ul className="divide-y border-b">
          {lines.map(({ part, draft, checked }) => (
            <QuoteLineRow
              key={part.id}
              idPrefix={id}
              part={part}
              draft={draft}
              checked={checked}
              showErrors={submitted}
              onChange={(change) => updateDraft(part, change)}
            />
          ))}
        </ul>
        <div className="flex items-baseline justify-end gap-6 pt-4 md:pr-12">
          <span className="text-sm font-medium">Total</span>
          <span className="min-w-36 text-right text-lg font-semibold tabular-nums">
            {total === null ? (
              <span className="text-sm font-normal text-muted-foreground">Complete every line</span>
            ) : (
              formatCents(total)
            )}
          </span>
        </div>
      </section>

      {saveError !== null && (
        <Alert variant="destructive" aria-live="polite">
          <CircleAlert />
          <AlertTitle>Couldn't save the quote</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? "Saving…" : "Save quote"}
        </Button>
        <Link href="/parts" className={cn(buttonVariants({ variant: "ghost", size: "lg" }))}>
          Back to parts
        </Link>
      </div>
    </form>
  );
}

function QuoteLineRow({
  idPrefix,
  part,
  draft,
  checked,
  showErrors,
  onChange,
}: {
  idPrefix: string;
  part: Part;
  draft: LineDraft;
  checked: CheckedLine;
  showErrors: boolean;
  onChange: (change: Partial<LineDraft>) => void;
}) {
  const quantityId = `${idPrefix}-quantity-${part.id}`;
  const priceId = `${idPrefix}-price-${part.id}`;
  const noteId = `${idPrefix}-note-${part.id}`;
  const note = stockNote(part, checked.quantity);
  const quantityError = showErrors && !checked.ok ? checked.quantityError : undefined;
  const priceError = showErrors && !checked.ok ? checked.unitPriceError : undefined;

  return (
    <li className="relative grid grid-cols-2 gap-x-3 gap-y-3 py-4 md:grid-cols-[minmax(0,1fr)_7rem_9rem_9rem_2rem] md:items-start md:gap-x-4">
      <div className="col-span-2 min-w-0 pr-10 md:col-span-1 md:pr-0">
        <p className="font-mono text-sm">{part.partNumber}</p>
        <p className="truncate text-xs text-muted-foreground">{part.supplier}</p>
        <p
          id={noteId}
          className={cn(
            "mt-1 flex items-start gap-1.5 text-xs",
            note.warning ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
          )}
        >
          {note.warning && <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />}
          {note.warning && <span className="sr-only">Warning: </span>}
          {note.text}
        </p>
      </div>

      <div className="grid content-start gap-1">
        <Label htmlFor={quantityId} className="text-xs md:sr-only">
          Quantity<span className="sr-only"> of {part.partNumber}</span>
        </Label>
        <Input
          id={quantityId}
          inputMode="numeric"
          value={draft.quantity}
          onChange={(event) => onChange({ quantity: event.target.value })}
          className="text-right tabular-nums"
          aria-invalid={quantityError !== undefined}
          aria-describedby={quantityError ? `${noteId} ${quantityId}-error` : noteId}
        />
        {quantityError && (
          <p id={`${quantityId}-error`} className="text-xs text-destructive">
            {quantityError}
          </p>
        )}
      </div>

      <div className="grid content-start gap-1">
        <Label htmlFor={priceId} className="text-xs md:sr-only">
          Unit price<span className="sr-only"> of {part.partNumber}</span>
        </Label>
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground"
          >
            $
          </span>
          <Input
            id={priceId}
            inputMode="decimal"
            value={draft.unitPrice}
            placeholder={part.price === null ? "Required" : undefined}
            onChange={(event) => onChange({ unitPrice: event.target.value })}
            className="pl-6 text-right tabular-nums"
            aria-invalid={priceError !== undefined}
            aria-describedby={priceError ? `${priceId}-error` : undefined}
          />
        </div>
        {priceError && (
          <p id={`${priceId}-error`} className="text-xs text-destructive">
            {priceError}
          </p>
        )}
      </div>

      <p className="col-span-2 text-right text-sm tabular-nums md:col-span-1 md:pt-1.5">
        <span className="text-muted-foreground md:sr-only">Line total </span>
        {checked.ok ? (
          formatCents(lineTotalCents(checked.unitPrice, checked.quantity))
        ) : (
          <span className="text-muted-foreground">No total yet</span>
        )}
      </p>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-3.5 right-0 md:static md:mt-0.5"
        aria-label={`Remove ${part.partNumber} from ${part.supplier}`}
        onClick={() => deselectPart(part.id)}
      >
        <X />
      </Button>
    </li>
  );
}
