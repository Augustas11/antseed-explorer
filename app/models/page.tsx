import Link from "next/link";
import type { Metadata } from "next";
import { getModelUsage, type ModelUsageSort } from "@/lib/queries";
import { fmtUsd, fmtNum, fmtCompact } from "@/lib/format";
import ModelTagChips from "../components/ModelTagChips";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Models — usage on the network | AntSeed Explorer",
  description:
    "Per-model network statistics on the AntSeed P2P AI network — spend, requests, tokens, buyers, sellers and price ranges sourced from on-chain v2 SpendingAuth attribution.",
};

const SORT_OPTIONS: Array<{ value: ModelUsageSort; label: string }> = [
  { value: "spend", label: "Spend" },
  { value: "sellers", label: "Sellers" },
  { value: "tokens", label: "Tokens" },
  { value: "requests", label: "Requests" },
];

function isSort(value: string | undefined): value is ModelUsageSort {
  return value === "spend" || value === "sellers" || value === "tokens" || value === "requests";
}

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; q?: string; tag?: string }>;
}) {
  const params = await searchParams;
  const sort: ModelUsageSort = isSort(params.sort) ? params.sort : "spend";
  const search = (params.q ?? "").trim().toLowerCase();
  const tag = (params.tag ?? "").trim().toLowerCase();

  const usage = await getModelUsage({ sort });
  const filteredRows = usage.rows.filter((row) => {
    if (search) {
      const haystack = [row.display, ...row.aliases].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (tag) {
      const tagsLower = row.tags.map((t) => t.toString().toLowerCase());
      if (!tagsLower.includes(tag)) return false;
    }
    return true;
  });

  const top8 = filteredRows.slice(0, 8);
  const maxSpend = top8[0]?.amount_usdc ?? 0;

  // Tag chip set from the visible rows so chips reflect what's actually here.
  const tagSet = new Set<string>();
  for (const row of filteredRows) {
    for (const t of row.tags) tagSet.add(t.toString());
  }
  const tagChips = [...tagSet].sort();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Models on the network
        </h1>
        <p className="text-muted text-sm mt-1">
          Spend, requests, tokens, buyers and sellers per AI model — sourced
          from on-chain v2 SpendingAuth attribution.
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat">
          <div className="stat-label">Models with usage</div>
          <div className="stat-value">{fmtNum(filteredRows.length)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">v2 attributed</div>
          <div className="stat-value text-base">
            {fmtUsd(usage.coverage.v2_attributed_usdc)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Decoded settled</div>
          <div className="stat-value text-base">
            {fmtUsd(usage.coverage.decoded_settled_usdc)}
          </div>
          {usage.coverage.pending_usdc > 0 && (
            <div className="text-xs text-muted mt-1">
              Pending decode: {fmtUsd(usage.coverage.pending_usdc)}
            </div>
          )}
          {usage.coverage.prefix_blocked_usdc > 0 && (
            <div className="text-xs text-muted">
              Prefix-blocked: {fmtUsd(usage.coverage.prefix_blocked_usdc)}
            </div>
          )}
        </div>
        <div className="stat">
          <div className="stat-label">v2 share</div>
          <div className="stat-value">
            {(usage.coverage.v2_share * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-muted mt-1">of decoded settled</div>
        </div>
      </section>

      {top8.length > 0 && (
        <section className="panel">
          <div className="px-4 py-3 border-b border-edge">
            <h2 className="font-medium">Top {top8.length} by spend</h2>
          </div>
          <div className="p-4 space-y-2">
            {top8.map((row) => {
              const pct = maxSpend > 0 ? (row.amount_usdc / maxSpend) * 100 : 0;
              return (
                <Link
                  key={row.service_key}
                  href={`/models/${encodeURIComponent(row.service_key)}`}
                  className="block hover:bg-card transition-colors rounded px-2 py-1"
                >
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium truncate pr-2">{row.display}</span>
                    <span className="text-muted shrink-0">{fmtUsd(row.amount_usdc)}</span>
                  </div>
                  <div className="h-1 bg-edge rounded mt-1 overflow-hidden">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${pct.toFixed(1)}%` }}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="px-4 py-3 border-b border-edge flex flex-wrap items-center gap-3">
          <h2 className="font-medium mr-auto">Models</h2>
          <form className="flex flex-wrap items-center gap-2 text-xs" method="get">
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="search model or alias"
              className="px-2 py-1 rounded bg-card border border-edge w-48"
            />
            <select
              name="sort"
              defaultValue={sort}
              className="px-2 py-1 rounded bg-card border border-edge"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  Sort: {opt.label}
                </option>
              ))}
            </select>
            {tag && <input type="hidden" name="tag" value={tag} />}
            <button
              type="submit"
              className="px-2 py-1 rounded bg-accent text-bg font-medium"
            >
              Apply
            </button>
          </form>
        </div>
        {tagChips.length > 0 && (
          <div className="px-4 py-2 border-b border-edge flex flex-wrap gap-1 text-xs">
            <Link
              href={{
                pathname: "/models",
                query: { ...(sort !== "spend" && { sort }), ...(search && { q: search }) },
              }}
              className={`px-2 py-0.5 rounded border ${
                tag ? "border-edge text-muted" : "border-accent text-accent"
              }`}
            >
              All
            </Link>
            {tagChips.map((t) => (
              <Link
                key={t}
                href={{
                  pathname: "/models",
                  query: { tag: t, ...(sort !== "spend" && { sort }), ...(search && { q: search }) },
                }}
                className={`px-2 py-0.5 rounded border ${
                  tag === t ? "border-accent text-accent" : "border-edge text-muted"
                }`}
              >
                {t}
              </Link>
            ))}
          </div>
        )}
        {filteredRows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">No models match.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Model</th>
                <th>Sellers</th>
                <th>Spend</th>
                <th>Requests</th>
                <th>In tok</th>
                <th>Out tok</th>
                <th>Cached %</th>
                <th>$/Mi in (min)</th>
                <th>$/Mi out (min)</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const cachedPct =
                  row.input_tokens > 0
                    ? (row.cached_input_tokens / row.input_tokens) * 100
                    : null;
                return (
                  <tr key={row.service_key}>
                    <td>
                      <Link
                        href={`/models/${encodeURIComponent(row.service_key)}`}
                        className="text-accent hover:underline font-medium"
                      >
                        {row.display}
                      </Link>
                    </td>
                    <td className="text-muted text-xs">{fmtNum(row.sellers)}</td>
                    <td className="text-muted text-xs">{fmtUsd(row.amount_usdc)}</td>
                    <td className="text-muted text-xs">{fmtNum(row.requests)}</td>
                    <td className="text-muted text-xs">{fmtCompact(row.input_tokens)}</td>
                    <td className="text-muted text-xs">{fmtCompact(row.output_tokens)}</td>
                    <td className="text-muted text-xs">
                      {cachedPct != null ? `${cachedPct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="text-muted text-xs">
                      {row.min_price_in != null
                        ? `$${row.min_price_in.toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="text-muted text-xs">
                      {row.min_price_out != null
                        ? `$${row.min_price_out.toFixed(2)}`
                        : "—"}
                    </td>
                    <td>
                      <ModelTagChips tags={row.tags} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {usage.unmapped.service_ids > 0 && (
        <section className="panel">
          <div className="px-4 py-3 border-b border-edge">
            <h2 className="font-medium text-sm">Unmapped service ids</h2>
            <p className="text-xs text-muted mt-1">
              {fmtNum(usage.unmapped.service_ids)} unknown service_id
              {usage.unmapped.service_ids === 1 ? "" : "s"} account for{" "}
              {fmtUsd(usage.unmapped.amount_usdc)}. These come from sellers
              advertising a model under a string our directory hasn&apos;t
              indexed yet.
            </p>
          </div>
          {usage.unmapped.top.length > 0 && (
            <div className="px-4 py-3 text-xs">
              <div className="text-muted mb-1">Top 5 hashes by spend:</div>
              <ul className="space-y-1">
                {usage.unmapped.top.map((u) => (
                  <li key={u.service_id} className="font-mono">
                    {u.service_id}
                    <span className="text-muted ml-2">
                      {fmtUsd(u.amount_usdc)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
