"use client";

import {
  createColumnHelper,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Part, PartSort, SortDirection } from "@/contracts/parts";
import { formatCount, formatDate, formatLeadTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

// Sorting, filtering, and paging all happen on the server, so the table only needs the sorting
// feature for its state and header toggles, with `manualSorting` keeping rows in server order.
const features = tableFeatures({ rowSortingFeature });
const column = createColumnHelper<typeof features, Part>();

/** An unknown value, always shown as text so a blank cell never stands for a missing number (A19). */
function Unknown({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function Unavailable() {
  return <Badge variant="outline">No longer available</Badge>;
}

const columns = column.columns([
  column.accessor("partNumber", {
    id: "part_number",
    header: "Part number",
    cell: ({ row }) => (
      <>
        <span className="font-mono whitespace-nowrap">{row.original.partNumber}</span>
        {/* Below `md`, the supplier and availability columns are hidden and shown here instead. */}
        <span className="block max-w-40 truncate text-xs text-muted-foreground md:hidden">
          {row.original.supplier}
        </span>
        {row.original.unavailableSince !== null && (
          <span className="mt-1 block md:hidden">
            <Unavailable />
          </span>
        )}
      </>
    ),
  }),
  column.accessor("supplier", {
    id: "supplier",
    header: "Supplier",
    enableSorting: false,
    cell: ({ getValue }) => (
      <span className="block truncate" title={getValue()}>
        {getValue()}
      </span>
    ),
  }),
  column.accessor("quantity", {
    id: "quantity",
    header: "Quantity",
    cell: ({ getValue }) => {
      const quantity = getValue();
      return quantity === null ? <Unknown>Unknown</Unknown> : formatCount(quantity);
    },
  }),
  column.accessor("price", {
    id: "price",
    header: "Price",
    cell: ({ getValue }) => {
      const price = getValue();
      return price === null ? <Unknown>No price</Unknown> : formatMoney(price);
    },
  }),
  column.accessor("leadTimeDays", {
    id: "lead_time",
    header: "Lead time",
    cell: ({ getValue }) => {
      const days = getValue();
      return days === null ? <Unknown>Unknown</Unknown> : formatLeadTime(days);
    },
  }),
  column.accessor("lastUpdated", {
    id: "last_updated",
    header: "Last updated",
    enableSorting: false,
    cell: ({ getValue }) => formatDate(getValue()),
  }),
  column.accessor("unavailableSince", {
    id: "availability",
    header: "Availability",
    enableSorting: false,
    cell: ({ getValue }) => (getValue() === null ? <Unknown>Available</Unknown> : <Unavailable />),
  }),
]);

/**
 * Below `md` the table is wider than the screen and scrolls sideways, so the checkbox and part
 * number columns stay pinned on the left, with a solid background that follows the row's selection.
 */
const PINNED =
  "max-md:sticky max-md:z-10 max-md:bg-background max-md:group-data-[state=selected]/row:bg-muted";

/**
 * Layout per column. Widths are fixed from `md` up, so columns stay put while the buyer pages and
 * sorts, and the supplier column takes what is left. Below `md`, the secondary columns are folded
 * into the part number cell.
 */
const COLUMN_CLASS: Record<string, string> = {
  part_number: `md:w-52 ${PINNED} max-md:left-10 max-md:shadow-[inset_-1px_0_0_var(--border)]`,
  supplier: "hidden md:table-cell",
  quantity: "text-right tabular-nums md:w-28",
  price: "text-right tabular-nums md:w-28",
  lead_time: "text-right tabular-nums md:w-28",
  last_updated: "hidden lg:table-cell lg:w-32",
  availability: "hidden md:table-cell md:w-44",
};

const NO_PARTS: Part[] = [];

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

/**
 * One page of parts, as the server sorted it, with a checkbox per row to select it for a quote.
 * Parts that are no longer available are dimmed, labeled, and can't be selected (A14).
 */
export function PartsTable({
  parts,
  loading,
  sort,
  dir,
  onSortChange,
  selectedIds,
  onSelectChange,
  empty,
}: {
  /** The page to show, or `undefined` before the first page has loaded. */
  parts: Part[] | undefined;
  /** Whether a newer page is loading, so `parts` may be stale. */
  loading: boolean;
  sort: PartSort;
  dir: SortDirection;
  onSortChange: (sort: PartSort, dir: SortDirection) => void;
  selectedIds: ReadonlySet<number>;
  onSelectChange: (part: Part, selected: boolean) => void;
  /** Shown in place of rows when the page has none. */
  empty: ReactNode;
}) {
  const sorting = useMemo<SortingState>(() => [{ id: sort, desc: dir === "desc" }], [sort, dir]);
  const table = useTable({
    features,
    columns,
    data: parts ?? NO_PARTS,
    getRowId: (part) => String(part.id),
    state: { sorting },
    onSortingChange: (updater) => {
      const [next] = typeof updater === "function" ? updater(sorting) : updater;
      if (next) {
        onSortChange(next.id as PartSort, next.desc ? "desc" : "asc");
      }
    },
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    sortDescFirst: false,
  });

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table className="md:table-fixed" aria-busy={loading}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="group/row hover:bg-transparent">
              <TableHead className={cn("w-10 pl-4", PINNED, "max-md:left-0")}>
                <span className="sr-only">Select</span>
              </TableHead>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const sortable = header.column.getCanSort();
                return (
                  <TableHead
                    key={header.id}
                    className={cn(COLUMN_CLASS[header.column.id], "last:pr-4")}
                    aria-sort={sortable ? (sorted ? ARIA_SORT[sorted] : "none") : undefined}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                          COLUMN_CLASS[header.column.id]?.includes("text-right") &&
                            "flex-row-reverse",
                        )}
                      >
                        <table.FlexRender header={header} />
                        {sorted === "asc" ? (
                          <ArrowUp aria-hidden className="size-3.5" />
                        ) : sorted === "desc" ? (
                          <ArrowDown aria-hidden className="size-3.5" />
                        ) : (
                          <ChevronsUpDown aria-hidden className="size-3.5 text-muted-foreground" />
                        )}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody className={cn("transition-opacity", loading && parts && "opacity-50")}>
          {parts === undefined
            ? SKELETON_ROWS.map((key) => <SkeletonRow key={key} />)
            : table.getRowModel().rows.map((row) => {
                const part = row.original;
                const unavailable = part.unavailableSince !== null;
                const selected = selectedIds.has(part.id);
                return (
                  <TableRow
                    key={row.id}
                    data-state={selected ? "selected" : undefined}
                    className={cn("group/row", unavailable && "text-muted-foreground")}
                  >
                    <TableCell className={cn("pl-4", PINNED, "max-md:left-0")}>
                      <Checkbox
                        checked={selected}
                        // A part that became unavailable after it was selected can still be
                        // unticked, but an unavailable part can never be ticked (A14).
                        disabled={unavailable && !selected}
                        onCheckedChange={(checked) => onSelectChange(part, checked)}
                        aria-label={`Select ${part.partNumber} from ${part.supplier}${
                          unavailable ? " (no longer available)" : ""
                        }`}
                      />
                    </TableCell>
                    {row.getAllCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(COLUMN_CLASS[cell.column.id], "last:pr-4")}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
        </TableBody>
      </Table>
      {parts?.length === 0 && (
        <div className="flex flex-col items-center gap-3 border-t px-6 py-12 text-center">
          {empty}
        </div>
      )}
    </div>
  );
}

const SKELETON_ROWS = Array.from({ length: 10 }, (_, i) => `skeleton-${i}`);

function SkeletonRow() {
  return (
    <TableRow className="group/row hover:bg-transparent">
      <TableCell className={cn("pl-4", PINNED, "max-md:left-0")}>
        <Skeleton className="size-4" />
      </TableCell>
      {columns.map((definition) => (
        <TableCell
          key={definition.id}
          className={cn(COLUMN_CLASS[definition.id ?? ""], "last:pr-4")}
        >
          <Skeleton className="h-5 w-full max-w-28" />
        </TableCell>
      ))}
    </TableRow>
  );
}
