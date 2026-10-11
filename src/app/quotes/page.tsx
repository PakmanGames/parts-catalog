import type { Metadata } from "next";

export const metadata: Metadata = { title: "Quotes" };

export default function QuotesPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Quotes</h1>
        <p className="text-sm text-muted-foreground">
          Open a saved quote to see its lines and total.
        </p>
      </div>
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-sm text-muted-foreground">
        Saved quotes will appear here.
      </div>
    </div>
  );
}
