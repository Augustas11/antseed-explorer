"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { fmtUsd, shortAddr } from "@/lib/format";
import { getModelTags, type ModelTag } from "@/lib/modelTags";
import type { ServiceFlatRow } from "@/lib/queries";
import ModelTagChips from "./ModelTagChips";
import StatusDot from "./StatusDot";
import VerifiedLabel from "./VerifiedLabel";

type SortField = "service_name" | "input_price" | "output_price" | "updated_at";
type SortDir = "asc" | "desc";

interface EnrichedRow extends ServiceFlatRow {
  tags: ModelTag[];
}

interface Props {
  rows: ServiceFlatRow[];
  loading?: boolean;
}

const ALL_TAGS: ModelTag[] = [
  "vision",
  "coding",
  "reasoning",
  "agents",
  "embedding",
  "audio",
  "open-source",
  "premium",
  "free",
];

function enrich(rows: ServiceFlatRow[]): EnrichedRow[] {
  return rows.map((r) => {
    const tags = [...getModelTags(r.service_name)];
    if (r.input_price === 0 && r.output_price === 0) tags.push("free");
    return { ...r, tags };
  });
}

function compareRows(a: EnrichedRow, b: EnrichedRow, field: SortField, dir: SortDir): number {
  const mul = dir === "asc" ? 1 : -1;
  if (field === "service_name") {
    return a.service_name.localeCompare(b.service_name) * mul;
  }
  let av: number | null;
  let bv: number | null;
  if (field === "input_price") {
    av = a.input_price; bv = b.input_price;
  } else if (field === "output_price") {
    av = a.output_price; bv = b.output_price;
  } else {
    av = a.updated_at; bv = b.updated_at;
  }
  if (av == null && bv == null) return 0;
  if (av == null) return 1; // nulls last regardless of direction
  if (bv == null) return -1;
  return (av - bv) * mul;
}

function priceCellClass(
  value: number | null,
  group: { min: number | null; max: number | null; count: number },
): string {
  if (value == null) return "text-muted";
  // Only highlight best/worst when there are multiple sellers to compare
  if (group.count > 1 && group.min != null && value === group.min) return "text-accent font-medium";
  if (group.count > 1 && group.max != null && value === group.max) return "text-warn";
  return "text-ink";
}

function fmtPrice(p: number | null): string {
  if (p == null) return "—";
  return fmtUsd(p);
}

export default function MarketplaceTable({ rows, loading = false }: Props) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);

  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<Set<ModelTag>>(new Set());
  const [sortField, setSortField] = useState<SortField>("service_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);

  // Defer query updates so keystrokes stay responsive at scale
  const deferredQuery = useDeferredValue(query);

  const enriched = useMemo(() => enrich(rows), [rows]);

  // Only show tags that actually appear in the dataset
  const availableTags = useMemo(() => {
    const present = new Set<ModelTag>();
    for (const r of enriched) for (const t of r.tags) present.add(t);
    return ALL_TAGS.filter((t) => present.has(t));
  }, [enriched]);

  // Per-service min/max for color coding — computed over ALL rows, not just filtered
  const groups = useMemo(() => {
    const map = new Map<string, { minIn: number | null; maxIn: number | null; minOut: number | null; maxOut: number | null; count: number }>();
    for (const r of enriched) {
      const g = map.get(r.service_name) ?? { minIn: null, maxIn: null, minOut: null, maxOut: null, count: 0 };
      g.count += 1;
      if (r.input_price != null) {
        g.minIn = g.minIn == null ? r.input_price : Math.min(g.minIn, r.input_price);
        g.maxIn = g.maxIn == null ? r.input_price : Math.max(g.maxIn, r.input_price);
      }
      if (r.output_price != null) {
        g.minOut = g.minOut == null ? r.output_price : Math.min(g.minOut, r.output_price);
        g.maxOut = g.maxOut == null ? r.output_price : Math.max(g.maxOut, r.output_price);
      }
      map.set(r.service_name, g);
    }
    return map;
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const tagsArr = Array.from(activeTags);
    let out = enriched.filter((r) => {
      if (q && !r.service_name.toLowerCase().includes(q)) return false;
      if (tagsArr.length > 0 && !tagsArr.some((t) => r.tags.includes(t))) return false;
      return true;
    });
    return out.sort((a, b) => compareRows(a, b, sortField, sortDir));
  }, [enriched, deferredQuery, activeTags, sortField, sortDir]);

  // Clamp selection index when filtered list shrinks
  useEffect(() => {
    if (selectedIdx >= filtered.length) setSelectedIdx(filtered.length > 0 ? filtered.length - 1 : -1);
  }, [filtered.length, selectedIdx]);

  // Scroll selected row into view on keyboard navigation
  useEffect(() => {
    if (selectedIdx < 0 || !tableRef.current) return;
    const row = tableRef.current.querySelector<HTMLTableRowElement>(`[data-idx="${selectedIdx}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const inField =
        active?.tagName === "INPUT" ||
        active?.tagName === "TEXTAREA" ||
        (active as HTMLElement | null)?.isContentEditable;

      if (e.key === "/" && !inField && !(e.metaKey || e.ctrlKey || e.altKey)) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (e.key === "Escape") {
        // Blur field first; a second Escape then clears the query
        if (inField) { (active as HTMLElement).blur(); return; }
        if (query) setQuery("");
        return;
      }

      if (e.key === "ArrowDown") {
        if (filtered.length === 0) return;
        // Only prevent page scroll once the user is already navigating the table
        if (selectedIdx >= 0) e.preventDefault();
        setSelectedIdx((i) => Math.min(filtered.length - 1, i < 0 ? 0 : i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        if (filtered.length === 0) return;
        if (selectedIdx >= 0) e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i < 0 ? 0 : i - 1));
        return;
      }

      // Only navigate when no button/input has focus — avoids double-firing on tag buttons
      if (
        e.key === "Enter" &&
        !inField &&
        active?.tagName !== "BUTTON" &&
        selectedIdx >= 0 &&
        selectedIdx < filtered.length
      ) {
        e.preventDefault();
        router.push(`/services/${encodeURIComponent(filtered[selectedIdx].service_name)}`);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered, selectedIdx, router, query]);

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "service_name" ? "asc" : "desc");
    }
  }

  function toggleTag(t: ModelTag) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
    setSelectedIdx(-1);
  }

  function clearFilters() {
    setQuery("");
    setActiveTags(new Set());
    setSelectedIdx(-1);
  }

  function ariaSortFor(field: SortField): "ascending" | "descending" | "none" {
    if (sortField !== field) return "none";
    return sortDir === "asc" ? "ascending" : "descending";
  }

  const sortGlyph = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? "↑" : "↓") : "";

  const hasActiveFilters = query.length > 0 || activeTags.size > 0;
  const showSkeleton = loading;
  const showEmpty = !loading && enriched.length === 0;
  const showZero = !loading && enriched.length > 0 && filtered.length === 0;

  return (
    <div className="space-y-4">
      {/* Search + tag cloud */}
      <div className="panel p-4 space-y-3">
        <div className="flex items-center gap-2">
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(-1); }}
            placeholder="Search services… (press / to focus)"
            className="flex-1 bg-panel border border-edge rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]"
            aria-label="Search services"
          />
          {hasActiveFilters && (
            <button onClick={clearFilters} className="btn text-xs">Clear</button>
          )}
        </div>
        {availableTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by capability (select multiple to broaden results)">
            {availableTags.map((t) => {
              const on = activeTags.has(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  aria-pressed={on}
                  className={`badge ${on ? "badge-good" : "badge-muted"} text-[11px] cursor-pointer`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        )}
        <div className="text-xs text-muted" aria-live="polite">
          {showSkeleton ? "Loading…" : `${filtered.length} of ${enriched.length} services`}
        </div>
      </div>

      {/* Desktop table */}
      <div className="panel hidden sm:block overflow-x-auto">
        {showSkeleton ? (
          <table className="tbl" aria-label="Loading services">
            <thead>
              <tr>
                <th>Service</th><th>Seller</th><th>Status</th>
                <th>Input $/M</th><th>Output $/M</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  <td><div className="h-4 w-40 rounded bg-edge animate-pulse" /></td>
                  <td><div className="h-4 w-28 rounded bg-edge animate-pulse" /></td>
                  <td><div className="h-2 w-2 rounded-full bg-edge animate-pulse" /></td>
                  <td><div className="h-4 w-16 rounded bg-edge animate-pulse" /></td>
                  <td><div className="h-4 w-16 rounded bg-edge animate-pulse" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : showEmpty ? (
          <div className="p-8 text-center text-muted text-sm">No services in directory yet.</div>
        ) : showZero ? (
          <div className="p-8 text-center text-muted text-sm">
            No services match your search.{" "}
            <button onClick={clearFilters} className="text-accent hover:underline">Clear filters</button>
          </div>
        ) : (
          <table
            className="tbl"
            ref={tableRef}
            tabIndex={0}
            aria-label="Available AI services"
          >
            <thead>
              <tr>
                <th aria-sort={ariaSortFor("service_name")}>
                  <button onClick={() => toggleSort("service_name")} className="inline-flex items-center gap-1 hover:text-accent">
                    Service <span className="text-[10px]">{sortGlyph("service_name")}</span>
                  </button>
                </th>
                <th>Seller</th>
                <th aria-sort={ariaSortFor("updated_at")}>
                  <button onClick={() => toggleSort("updated_at")} className="inline-flex items-center gap-1 hover:text-accent">
                    Status <span className="text-[10px]">{sortGlyph("updated_at")}</span>
                  </button>
                </th>
                <th className="text-right" aria-sort={ariaSortFor("input_price")}>
                  <button onClick={() => toggleSort("input_price")} className="inline-flex items-center gap-1 hover:text-accent">
                    Input $/M <span className="text-[10px]">{sortGlyph("input_price")}</span>
                  </button>
                </th>
                <th className="text-right" aria-sort={ariaSortFor("output_price")}>
                  <button onClick={() => toggleSort("output_price")} className="inline-flex items-center gap-1 hover:text-accent">
                    Output $/M <span className="text-[10px]">{sortGlyph("output_price")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const prev = i > 0 ? filtered[i - 1] : null;
                const groupHead = !prev || prev.service_name !== row.service_name;
                const g = groups.get(row.service_name) ?? { minIn: null, maxIn: null, minOut: null, maxOut: null, count: 1 };
                const selected = i === selectedIdx;
                const borderClass = groupHead && i > 0 ? "border-t-2 border-edge" : "";
                return (
                  <tr
                    key={`${row.service_name}-${row.provider_address}`}
                    data-idx={i}
                    aria-selected={selected}
                    aria-rowindex={i + 1}
                    className={selected ? "bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]" : ""}
                    onMouseEnter={() => setSelectedIdx(i)}
                  >
                    <td className={borderClass}>
                      {groupHead ? (
                        <Link
                          href={`/services/${encodeURIComponent(row.service_name)}`}
                          className="font-mono text-sm text-ink hover:text-accent"
                        >
                          {row.service_name}
                        </Link>
                      ) : (
                        <span className="inline-block pl-4 text-muted/40">↳</span>
                      )}
                      {groupHead && row.tags.length > 0 && (
                        <span className="ml-2"><ModelTagChips tags={row.tags} /></span>
                      )}
                    </td>
                    <td className={borderClass}>
                      <Link
                        href={`/sellers/${row.provider_address}`}
                        className="font-mono text-accent hover:underline text-xs"
                      >
                        {row.display_name ?? shortAddr(row.provider_address)}
                      </Link>
                      {row.display_name && <VerifiedLabel displayName={row.display_name} />}
                    </td>
                    <td className={borderClass}>
                      <StatusDot updatedAt={row.updated_at} />
                    </td>
                    <td className={`${borderClass} text-right tabular-nums ${priceCellClass(row.input_price, { min: g.minIn, max: g.maxIn, count: g.count })}`}>
                      {fmtPrice(row.input_price)}
                    </td>
                    <td className={`${borderClass} text-right tabular-nums ${priceCellClass(row.output_price, { min: g.minOut, max: g.maxOut, count: g.count })}`}>
                      {fmtPrice(row.output_price)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Mobile cards — one card per service group */}
      <div className="sm:hidden space-y-2">
        {showSkeleton ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="panel p-4">
              <div className="h-4 w-2/3 rounded bg-edge animate-pulse" />
              <div className="mt-2 h-3 w-1/2 rounded bg-edge animate-pulse" />
            </div>
          ))
        ) : showEmpty ? (
          <div className="panel p-8 text-center text-muted text-sm">No services in directory yet.</div>
        ) : showZero ? (
          <div className="panel p-8 text-center text-muted text-sm">
            No services match your search.{" "}
            <button onClick={clearFilters} className="text-accent hover:underline">Clear filters</button>
          </div>
        ) : (
          Array.from(
            filtered.reduce((acc, r) => {
              if (!acc.has(r.service_name)) {
                // Tags derived from name are deterministic; add `free` only if ALL providers are free
                acc.set(r.service_name, { rows: [] as EnrichedRow[], nameTags: getModelTags(r.service_name) });
              }
              acc.get(r.service_name)!.rows.push(r);
              return acc;
            }, new Map<string, { rows: EnrichedRow[]; nameTags: ModelTag[] }>()).entries(),
          ).map(([name, { rows: gRows, nameTags }]) => {
            const g = groups.get(name);
            // Match filter logic: show "free" chip if ANY seller offers it free
            const hasFree = gRows.some((r) => r.input_price === 0 && r.output_price === 0);
            const displayTags: ModelTag[] = hasFree ? [...nameTags, "free"] : nameTags;
            return (
              <Link
                key={name}
                href={`/services/${encodeURIComponent(name)}`}
                className="panel p-4 block space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-mono text-sm text-ink break-all">{name}</div>
                  <ModelTagChips tags={displayTags} />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div>
                    <span className="text-muted text-xs">Sellers </span>
                    <span>{gRows.length}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs">Best in </span>
                    <span className="text-accent tabular-nums">{g?.minIn != null ? fmtUsd(g.minIn) : "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs">Best out </span>
                    <span className="text-accent tabular-nums">{g?.minOut != null ? fmtUsd(g.minOut) : "—"}</span>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
