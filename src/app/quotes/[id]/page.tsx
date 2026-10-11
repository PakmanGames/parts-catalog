import type { Metadata } from "next";
import { QuoteDetail } from "@/components/quote-detail";

export async function generateMetadata({ params }: PageProps<"/quotes/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: `Quote ${id}` };
}

export default async function QuotePage({ params }: PageProps<"/quotes/[id]">) {
  const { id } = await params;
  return <QuoteDetail id={id} />;
}
