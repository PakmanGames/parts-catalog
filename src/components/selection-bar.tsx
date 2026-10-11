"use client";

import { ChevronUp, X } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { clearSelection, deselectPart, useSelection } from "@/hooks/use-selection";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The "Selected (N)" panel (PRD 7.5), pinned to the bottom of the Parts page while anything is
 * selected. It lists the selection, which can span many pages and searches, lets the buyer remove
 * parts, and starts a quote from them.
 */
export function SelectionBar() {
  const selected = useSelection();
  const listId = useId();
  const [open, setOpen] = useState(false);

  if (selected === null || selected.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Selected parts"
      className="sticky bottom-0 z-10 -mx-6 mt-auto border-t bg-background/95 px-6 py-3 shadow-[0_-4px_12px_-8px_rgb(0_0_0/0.15)] backdrop-blur supports-backdrop-filter:bg-background/80"
    >
      <ul
        id={listId}
        hidden={!open}
        className="mb-3 max-h-64 divide-y overflow-y-auto rounded-lg border"
      >
        {selected.map((part) => (
          <li key={part.id} className="flex items-center gap-3 py-1.5 pr-1.5 pl-3 text-sm">
            <div className="min-w-0 flex-1">
              <span className="font-mono">{part.partNumber}</span>
              <span className="block truncate text-xs text-muted-foreground">{part.supplier}</span>
            </div>
            <span className="text-right tabular-nums">
              {part.price === null ? (
                <span className="text-muted-foreground">No price</span>
              ) : (
                formatMoney(part.price)
              )}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${part.partNumber} from ${part.supplier}`}
              onClick={() => deselectPart(part.id)}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((shown) => !shown)}
        >
          Selected ({selected.length})
          <ChevronUp
            data-icon="inline-end"
            className={cn("transition-transform", !open && "rotate-180")}
          />
        </Button>
        <Button variant="ghost" onClick={clearSelection}>
          Clear
        </Button>
        <Link href="/quotes/new" className={cn(buttonVariants(), "ml-auto")}>
          Create quote
        </Link>
      </div>
    </section>
  );
}
