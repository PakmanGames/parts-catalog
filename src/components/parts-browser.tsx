"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { ImportPanel } from "@/components/import-panel";
import { LoadError } from "@/components/load-error";
import { PartsTable } from "@/components/parts-table";
import { SelectionBar } from "@/components/selection-bar";
import { SupplierFilter } from "@/components/supplier-filter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Part, PartSort, SortDirection } from "@/contracts/parts";
import { useApiData } from "@/hooks/use-api-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { deselectPart, selectPart, useSelection } from "@/hooks/use-selection";
import { listParts, listSuppliers } from "@/lib/api";

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 300;

/**
 * The Parts page's interactive part: the import panel, then the catalog with search, a supplier
 * filter, sortable columns, and paging, all done by the server (PRD R2, 7.5).
 */
export function PartsBrowser() {
  const searchId = useId();
  const tableTop = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [order, setOrder] = useState<{ sort: PartSort; dir: SortDirection }>({
    sort: "part_number",
    dir: "asc",
  });

  // Keyset paging can only go back through cursors it has seen, so the client keeps the stack of
  // cursors that led to the current page (7.4). The stack belongs to one query: when the search,
  // filter, or sort changes, the key no longer matches and paging starts again from page 1.
  const queryKey = JSON.stringify([q, suppliers, order]);
  const [paging, setPaging] = useState({ queryKey, cursors: [] as string[] });
  const cursors = paging.queryKey === queryKey ? paging.cursors : [];
  const cursor = cursors.at(-1);

  const loadParts = useCallback(
    (signal: AbortSignal) =>
      listParts(
        { q, supplier: suppliers, sort: order.sort, dir: order.dir, limit: PAGE_SIZE, cursor },
        signal,
      ),
    [q, suppliers, order, cursor],
  );
  const parts = useApiData(loadParts);
  const supplierList = useApiData(listSuppliers);
  const page =
    parts.status === "ready" ? parts.data : parts.status === "loading" ? parts.previous : undefined;

  const reloadParts = parts.reload;
  const reloadSuppliers = supplierList.reload;
  // An import can change any part and add suppliers, so reload both, staying on the same page.
  const refresh = useCallback(() => {
    reloadParts();
    reloadSuppliers();
  }, [reloadParts, reloadSuppliers]);

  const selected = useSelection();
  const selectedIds = useMemo(() => new Set(selected?.map((part) => part.id)), [selected]);
  const onSelectChange = useCallback((part: Part, checked: boolean) => {
    if (checked) {
      selectPart(part);
    } else {
      deselectPart(part.id);
    }
  }, []);

  function goToPage(nextCursors: string[]) {
    setPaging({ queryKey, cursors: nextCursors });
    // The pager sits below the table, so bring the new page's first rows into view.
    tableTop.current?.scrollIntoView({ block: "nearest" });
  }

  const filtered = q !== "" || suppliers.length > 0;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ImportPanel onImported={refresh} />

      <section aria-labelledby={`${searchId}-heading`} className="flex flex-col gap-3">
        <h2 id={`${searchId}-heading`} className="sr-only">
          Catalog
        </h2>
        <div
          ref={tableTop}
          className="grid scroll-mt-4 gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        >
          <div className="relative">
            <Label htmlFor={searchId} className="sr-only">
              Search part numbers
            </Label>
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={searchId}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search part numbers, such as NAS1149"
              autoComplete="off"
              spellCheck={false}
              className="pl-8"
            />
          </div>
          <SupplierFilter suppliers={supplierList} value={suppliers} onValueChange={setSuppliers} />
        </div>

        {parts.status === "error" ? (
          <LoadError title="Couldn't load parts" message={parts.error.message} onRetry={refresh} />
        ) : (
          <PartsTable
            parts={page?.items}
            loading={parts.status === "loading"}
            sort={order.sort}
            dir={order.dir}
            onSortChange={(sort, dir) => setOrder({ sort, dir })}
            selectedIds={selectedIds}
            onSelectChange={onSelectChange}
            empty={
              filtered ? (
                <>
                  <p className="font-medium">No parts match</p>
                  <p className="text-sm text-muted-foreground">
                    Search matches anywhere in the part number, ignoring spaces, dashes, and case.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setSuppliers([]);
                    }}
                  >
                    Clear search and suppliers
                  </Button>
                </>
              ) : (
                <>
                  <p className="font-medium">The catalog is empty</p>
                  <p className="text-sm text-muted-foreground">
                    Import the nightly export above to fill it.
                  </p>
                </>
              )
            }
          />
        )}

        {parts.status !== "error" && (cursors.length > 0 || page?.nextCursor) && (
          <nav aria-label="Pages" className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              disabled={cursors.length === 0 || parts.status === "loading"}
              onClick={() => goToPage(cursors.slice(0, -1))}
            >
              <ChevronLeft data-icon="inline-start" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums">
              Page {cursors.length + 1}
            </span>
            <Button
              variant="outline"
              disabled={!page?.nextCursor || parts.status === "loading"}
              onClick={() => page?.nextCursor && goToPage([...cursors, page.nextCursor])}
            >
              Next
              <ChevronRight data-icon="inline-end" />
            </Button>
          </nav>
        )}
      </section>

      <SelectionBar />
    </div>
  );
}
