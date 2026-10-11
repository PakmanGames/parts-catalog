import { formatDateTime } from "@/lib/format";

/** An API timestamp in the buyer's time zone, kept on one line so the time never wraps from its date. */
export function Timestamp({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} className="whitespace-nowrap">
      {formatDateTime(iso)}
    </time>
  );
}
