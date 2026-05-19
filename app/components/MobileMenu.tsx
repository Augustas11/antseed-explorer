"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DOCS_HREF, NAV_ITEMS } from "../lib/nav-items";
import SearchBar from "./SearchBar";
import ThemeToggle from "./ThemeToggle";

export default function MobileMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="relative z-[90] shrink-0 md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-menu-panel"
        className="btn flex min-h-10 min-w-10 cursor-pointer items-center justify-center px-2.5 py-2"
      >
        <span className="sr-only">Menu</span>
        <span className="flex h-4 w-5 flex-col justify-between" aria-hidden="true">
          <span className={`h-px w-full bg-current transition-transform ${open ? "translate-y-[7.5px] rotate-45" : ""}`} />
          <span className={`h-px w-full bg-current transition-opacity ${open ? "opacity-0" : ""}`} />
          <span className={`h-px w-full bg-current transition-transform ${open ? "-translate-y-[7.5px] -rotate-45" : ""}`} />
        </span>
      </button>

      <button
        type="button"
        aria-label="Close menu"
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-[70] cursor-default bg-bg/90 backdrop-blur-md transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />

      <aside
        id="mobile-menu-panel"
        aria-label="Mobile navigation"
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-[80] flex h-dvh w-screen flex-col border-l border-edge bg-bg shadow-2xl shadow-black/60 transition-transform duration-300 ease-out sm:max-w-sm ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-edge p-4">
          <div>
            <div className="text-sm font-medium text-ink">Menu</div>
            <div className="text-xs text-muted">Navigate AntFeed</div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="cursor-pointer rounded-md border border-edge px-2.5 py-1.5 text-xs text-muted hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <SearchBar />
          </div>

          <nav className="grid gap-2">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`rounded-lg border px-3 py-3 text-sm transition-colors ${
                    active
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-edge bg-bg/30 text-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <a
              href={DOCS_HREF}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-edge bg-bg/30 px-3 py-3 text-sm text-muted hover:text-ink"
            >
              Docs ↗
            </a>
          </nav>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-edge p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <ThemeToggle />
          <div className="flex items-center gap-3 text-muted">
            <a
              href="https://github.com/Augustas11/antseed-explorer"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
              className="hover:text-ink transition-colors"
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
              className="hover:text-ink transition-colors"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
              </svg>
            </a>
          </div>
        </div>
      </aside>
    </div>
  );
}
