import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppNav } from "@/components/app-nav";
import "./globals.css";

// The variable names match the font tokens in globals.css.
const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Parts Catalog", template: "%s · Parts Catalog" },
  description: "Search the nightly parts export and build quotes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
            <span className="font-semibold tracking-tight">Parts Catalog</span>
            <AppNav />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
