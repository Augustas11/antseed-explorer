import "./globals.css";
import Link from "next/link";
import type { Metadata } from "next";
import SyncButton from "./components/SyncButton";

export const metadata: Metadata = {
  title: "AntSeed Demand Explorer",
  description: "On-chain buyer intelligence for the AntSeed P2P AI network",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-edge bg-bg/80 backdrop-blur sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/" className="font-semibold tracking-tight text-ink">
                AntSeed <span className="text-accent">Demand</span> Explorer
              </Link>
              <nav className="flex items-center gap-4 text-sm text-muted">
                <Link href="/" className="hover:text-ink">Network</Link>
                <Link href="/buyers" className="hover:text-ink">Buyers</Link>
                <a
                  href="https://antseed.com/docs/payments"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-ink"
                >
                  Docs
                </a>
              </nav>
            </div>
            <SyncButton />
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
        <footer className="max-w-6xl mx-auto px-6 py-10 text-xs text-muted border-t border-edge mt-16">
          Independent buyer-side index of the{" "}
          <a className="underline hover:text-ink" href="https://antseed.com">
            AntSeed
          </a>{" "}
          P2P AI services network. Not affiliated with the AntSeed team.
        </footer>
      </body>
    </html>
  );
}

