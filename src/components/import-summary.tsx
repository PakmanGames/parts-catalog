import { type ReactNode, useId } from "react";
import type { ImportSummary as Summary } from "@/contracts/imports";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Every count of an import's summary (PRD R1.6): what happened to the rows of the file, with
 * rejected rows by reason, and what happened to the parts in the catalog. Parts whose newest row
 * was rejected are listed with the rows, since that is about the file; the catalog counts them
 * under "Marked unavailable" or not at all (A17).
 */
export function ImportSummary({ summary }: { summary: Summary }) {
  const id = useId();
  const reasons = Object.entries(summary.rejected).sort(([, a], [, b]) => b - a);
  const rejected = reasons.reduce((sum, [, n]) => sum + n, 0);

  return (
    <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
      <section aria-labelledby={`${id}-rows`}>
        <h3 id={`${id}-rows`} className="mb-1 text-sm font-medium">
          Rows in the file
        </h3>
        <dl>
          <Count label="Rows read" value={summary.rowsRead} />
          <Count label="Rejected" value={rejected}>
            {reasons.length > 0 && (
              <dl aria-label="Rejected rows by reason" className="mt-1 border-l pl-3">
                {reasons.map(([reason, n]) => (
                  <Count key={reason} label={sentenceCase(reason)} value={n} muted />
                ))}
              </dl>
            )}
          </Count>
          <Count label="Duplicates collapsed" value={summary.duplicatesCollapsed} />
          <Count label="Parts whose newest row was rejected" value={summary.newestRejected} />
        </dl>
      </section>
      <section aria-labelledby={`${id}-parts`}>
        <h3 id={`${id}-parts`} className="mb-1 text-sm font-medium">
          Parts in the catalog
        </h3>
        <dl>
          <Count label="Inserted" value={summary.inserted} />
          <Count label="Updated" value={summary.updated} />
          <Count label="Unchanged" value={summary.unchanged} />
          <Count label="Made available again" value={summary.madeAvailable} />
          <Count label="Marked unavailable" value={summary.markedUnavailable} />
        </dl>
      </section>
    </div>
  );
}

function Count({
  label,
  value,
  muted,
  children,
}: {
  label: string;
  value: number;
  muted?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-4 py-1 text-sm",
        muted && "text-muted-foreground",
      )}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatCount(value)}</dd>
      {children && <dd className="basis-full">{children}</dd>}
    </div>
  );
}

/** Rejection reasons are written as clauses, such as "row is empty", so capitalize them as labels. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
