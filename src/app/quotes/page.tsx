import type { Metadata } from "next";
import { QuoteList } from "@/components/quote-list";

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
      <QuoteList />
    </div>
  );
}
