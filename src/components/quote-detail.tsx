"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";
import { LoadError } from "@/components/load-error";
import { Timestamp } from "@/components/timestamp";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApiData } from "@/hooks/use-api-data";
import { ApiError, getQuote } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * A saved quote's lines, their totals, and the quote total, all as the server calculated them.
 * `id` is the URL segment as typed, since the API answers `404` for any id that isn't a quote.
 */
export function QuoteDetail({ id }: { id: string }) {
  const load = useCallback((signal: AbortSignal) => getQuote(id, signal), [id]);
  const quote = useApiData(load);

  if (quote.status === "error") {
    if (quote.error instanceof ApiError && quote.error.status === 404) {
      return <NotFound id={id} />;
    }
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <LoadError
          title="Couldn't load this quote"
          message={quote.error.message}
          onRetry={quote.retry}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-3">
        <BackLink />
        {quote.status === "loading" ? (
          <div className="flex w-full flex-col gap-1">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="h-5 w-72 max-w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight break-words">
              {quote.data.customerName}
            </h1>
            <p className="text-sm text-muted-foreground">
              Quote {quote.data.id}, created <Timestamp iso={quote.data.createdAt} />
            </p>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4 md:w-60">Part number</TableHead>
              <TableHead className="hidden md:table-cell">Supplier</TableHead>
              <TableHead className="hidden text-right sm:table-cell md:w-28">Quantity</TableHead>
              <TableHead className="hidden text-right sm:table-cell md:w-32">Unit price</TableHead>
              <TableHead className="pr-4 text-right md:w-40">Line total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quote.status === "loading" ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : (
              quote.data.lines.map((line) => (
                <TableRow key={line.partId} className="hover:bg-transparent">
                  <TableCell className="pl-4 whitespace-normal">
                    <span className="font-mono whitespace-nowrap">{line.partNumber}</span>
                    <span className="block text-xs text-muted-foreground md:hidden">
                      {line.supplier}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{line.supplier}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {formatCount(line.quantity)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {formatMoney(line.unitPrice)}
                  </TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">
                    {formatMoney(line.lineTotal)}
                    <span className="block text-xs text-muted-foreground sm:hidden">
                      {formatCount(line.quantity)} × {formatMoney(line.unitPrice)}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-4">Total</TableCell>
              <TableCell className="hidden md:table-cell" />
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="pr-4 text-right tabular-nums">
                {quote.status === "loading" ? (
                  <Skeleton className="ml-auto h-5 w-24" />
                ) : (
                  formatMoney(quote.data.total)
                )}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/quotes"
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 self-start")}
    >
      <ArrowLeft data-icon="inline-start" />
      Quotes
    </Link>
  );
}

function NotFound({ id }: { id: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
      <h1 className="font-medium">Quote not found</h1>
      <p className="text-sm text-muted-foreground break-all">No quote has the id “{id}”.</p>
      <Link href="/quotes" className={cn(buttonVariants({ variant: "outline" }))}>
        See all quotes
      </Link>
    </div>
  );
}

function SkeletonRow() {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="pl-4">
        <Skeleton className="h-5 w-32" />
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <Skeleton className="h-5 w-44" />
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Skeleton className="ml-auto h-5 w-10" />
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Skeleton className="ml-auto h-5 w-16" />
      </TableCell>
      <TableCell className="pr-4">
        <Skeleton className="ml-auto h-5 w-20" />
      </TableCell>
    </TableRow>
  );
}
