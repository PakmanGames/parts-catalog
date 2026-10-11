import type { Metadata } from "next";
import { QuoteForm } from "@/components/quote-form";

export const metadata: Metadata = { title: "New quote" };

export default function NewQuotePage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">New quote</h1>
        <p className="text-sm text-muted-foreground">
          Enter the customer, check each quantity and unit price, then save.
        </p>
      </div>
      <QuoteForm />
    </div>
  );
}
