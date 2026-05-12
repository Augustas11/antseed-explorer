import "./globals.css";
import Link from "next/link";
import type { Metadata } from "next";
import SyncButton from "./components/SyncButton";
import SearchBar from "./components/SearchBar";
import { Analytics } from "@vercel/analytics/next";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.antfeed.org"),
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
                <Link href="/sellers" className="hover:text-ink">Sellers</Link>
                <Link href="/channels" className="hover:text-ink">Channels</Link>
                <Link href="/services" className="hover:text-ink">Services</Link>
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
            <div className="flex items-center gap-3">
              <SearchBar />
              <a
                href="https://github.com/Augustas11/antseed-explorer"
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
                className="text-muted hover:text-ink transition-colors"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
              </a>
              <a
                href="https://x.com/AntFeed_"
                target="_blank"
                rel="noreferrer"
                aria-label="X (Twitter)"
                className="text-muted hover:text-ink transition-colors"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
                </svg>
              </a>
              <SyncButton />
            </div>
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
        <Analytics />
      </body>
    </html>
  );
}

