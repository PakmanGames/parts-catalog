/**
 * Formatting for counts, times, and sizes shown in the UI. Money has its own module, `money.ts`.
 *
 * Numbers use a fixed `en-US` locale so they match the money format, which is always US dollars.
 * Times use the browser's time zone, because the buyer reads them as local times.
 */

const count = new Intl.NumberFormat("en-US");
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const utcDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

/** Formats a whole count with thousands separators, such as "1,203,487". */
export function formatCount(value: number): string {
  return count.format(value);
}

/** Formats an ISO timestamp from the API in the browser's time zone, such as "Oct 10, 2026, 3:02 PM". */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/**
 * Formats the date of a part's last-updated timestamp, such as "Mar 18, 2026".
 * The export's dates without a time are stored as midnight UTC (data profile P28), so the date is
 * read in UTC; in the browser's zone, west of UTC, every one of them would show the day before.
 */
export function formatDate(iso: string): string {
  return utcDate.format(new Date(iso));
}

/** Formats a lead time in whole days, such as "1 day" or "21 days". */
export function formatLeadTime(days: number): string {
  return days === 1 ? "1 day" : `${formatCount(days)} days`;
}

/** Formats a duration such as "0.4 s", "42 s", or "1 min 10 s". */
export function formatDuration(ms: number): string {
  if (ms < 10_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/**
 * Formats a byte count in decimal megabytes, such as "36.1 MB".
 * Decimal, not binary, so it reads the same way as the upload limit of 100 MB.
 */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
