"use client";

import Link from "next/link";
import { LoadError } from "@/components/load-error";
import { Timestamp } from "@/components/timestamp";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { QuoteListItem } from "@/contracts/quotes";
import { useApiData } from "@/hooks/use-api-data";
import { listQuotes } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Every saved quote, newest first, as the API orders them (PRD R3.3). */
export function QuoteList() {
  const quotes = useApiData(listQuotes);

  if (quotes.status === "error") {
    return (
      <LoadError
        title="Couldn't load quotes"
        message={quotes.error.message}
        onRetry={quotes.retry}
      />
    );
  }
  if (quotes.status === "ready" && quotes.data.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
        <p className="font-medium">No quotes yet</p>
        <p className="text-sm text-muted-foreground">
          Select parts on the Parts page, then create a quote from them.
        </p>
        <Link href="/parts" className={cn(buttonVariants({ variant: "outline" }))}>
          Go to Parts
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Customer</TableHead>
            <TableHead className="hidden w-52 sm:table-cell">Created</TableHead>
            <TableHead className="text-right sm:w-20">Lines</TableHead>
            <TableHead className="pr-4 text-right sm:w-40">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {quotes.status === "loading" ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : (
            quotes.data.items.map((quote) => <QuoteRow key={quote.id} quote={quote} />)
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function QuoteRow({ quote }: { quote: QuoteListItem }) {
  const created = <Timestamp iso={quote.createdAt} />;
  return (
    // `relative` lets the link's overlay cover the whole row, so any part of it opens the quote.
    <TableRow className="relative">
      <TableCell className="min-w-40 pl-4 whitespace-normal">
        <Link
          href={`/quotes/${quote.id}`}
          className="font-medium break-words outline-none after:absolute after:inset-0 hover:underline focus-visible:after:rounded-[inherit] focus-visible:after:ring-3 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
        >
          {quote.customerName}
        </Link>
        <span className="block text-xs text-muted-foreground sm:hidden">{created}</span>
      </TableCell>
      <TableCell className="hidden text-muted-foreground sm:table-cell">{created}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCount(quote.lineCount)}</TableCell>
      <TableCell className="pr-4 text-right tabular-nums">{formatMoney(quote.total)}</TableCell>
    </TableRow>
  );
}

function SkeletonRow() {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="pl-4">
        <Skeleton className="h-5 w-40" />
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Skeleton className="h-5 w-36" />
      </TableCell>
      <TableCell>
        <Skeleton className="ml-auto h-5 w-6" />
      </TableCell>
      <TableCell className="pr-4">
        <Skeleton className="ml-auto h-5 w-20" />
      </TableCell>
    </TableRow>
  );
}
