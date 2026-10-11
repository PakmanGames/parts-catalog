import type { Metadata } from "next";
import { ImportPanel } from "@/components/import-panel";

export const metadata: Metadata = { title: "Parts" };

export default function PartsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Parts</h1>
        <p className="text-sm text-muted-foreground">
          Search the catalog, compare stock, price, and lead time, and select parts to quote.
        </p>
      </div>
      {/* The parts table will pass its refresh as `onImported`, so a finished import shows up in it. */}
      <ImportPanel />
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-sm text-muted-foreground">
        The parts table will appear here.
      </div>
    </div>
  );
}
