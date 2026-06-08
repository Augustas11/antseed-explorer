"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

interface SearchMatch {
  type: "buyer" | "seller" | "channel" | "tx" | "service";
  label: string;
  detail: string;
  href: string;
  exact: boolean;
}

export default function SearchBar() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      setMatches([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload: { matches?: SearchMatch[] } = await res.json();
        if (controller.signal.aborted) return;
        setMatches(payload.matches ?? []);
        setOpen(true);
        setActiveIndex(-1);
      } catch {
        if (controller.signal.aborted) return;
        setMatches([]);
        setOpen(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  const destination = useMemo(() => {
    if (activeIndex >= 0 && activeIndex < matches.length) return matches[activeIndex].href;
    if (matches.length === 1) return matches[0].href;
    return null;
  }, [activeIndex, matches]);

  function submitSearch() {
    if (!trimmed) return;
    if (destination) {
      router.push(destination);
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    router.push("/search?q=" + encodeURIComponent(trimmed));
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitSearch();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && matches.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((idx) => Math.min(matches.length - 1, idx + 1));
    } else if (e.key === "ArrowUp" && matches.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((idx) => Math.max(0, idx < 0 ? matches.length - 1 : idx - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    }
  }

  return (
    <div className="relative w-full md:w-72">
      <form onSubmit={handleSubmit} className="flex w-full items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => matches.length > 0 && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={handleKeyDown}
          placeholder="Search address, model, tx…"
          className="min-w-0 flex-1 bg-panel border border-edge rounded px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-accent/60"
          aria-label="Search AntFeed"
          aria-expanded={open}
          aria-controls="header-search-results"
        />
        <button type="submit" className="btn text-xs py-1.5 px-2" aria-label="Search">
          →
        </button>
      </form>

      {open && trimmed.length >= 2 && (
        <div
          id="header-search-results"
          className="absolute left-0 right-0 top-full z-[100] mt-2 overflow-hidden rounded border border-edge bg-panel shadow-xl shadow-black/30"
        >
          {matches.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted">No matches</div>
          ) : (
            <div className="max-h-80 overflow-y-auto py-1">
              {matches.map((match, index) => (
                <Link
                  key={`${match.type}:${match.href}`}
                  href={match.href}
                  className={`block px-3 py-2 text-sm transition-colors ${
                    index === activeIndex ? "bg-accent/10 text-accent" : "hover:bg-accent/5"
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{match.label}</span>
                      <span className="block truncate text-xs text-muted">{match.detail}</span>
                    </span>
                    <span className="badge badge-muted shrink-0 text-[10px]">{match.type}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
