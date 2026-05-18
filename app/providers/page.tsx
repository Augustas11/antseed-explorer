import type { Metadata } from "next";
import Link from "next/link";
import {
  listProviders,
  listProviderFacets,
  type DirectoryProviderRow,
  type ProviderSortKey,
} from "@/lib/queries";
import { fmtUsd, fmtNum, fmtRelative, shortAddr } from "@/lib/format";
import { computeTrust, reputationBadge, trustTooltip } from "@/lib/reputation";
import FilterBar from "./FilterBar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Provider Directory | AntSeed Explorer",
  description:
    "AntSeed AI service providers on Base, updated hourly from network.antseed.com",
};

const SORT_KEYS: ProviderSortKey[] = [
  "volume",
  "sessions",
  "ghost",
  "joined",
  "reputation",
];

function ghostRate(row: DirectoryProviderRow): number | null {
  if (row.closedCount === 0) return null;
  return row.ghostCount / row.closedCount;
}

function ghostRateClass(rate: number | null): string {
  if (rate === null) return "text-muted";
  if (rate > 0.2) return "text-red-400";
  if (rate > 0.1) return "text-yellow-400";
  return "text-green-500";
}

function fmtPrice(
  pricing: DirectoryProviderRow["pricing"],
  services: string[],
): string {
  const prices: number[] = [];
  for (const svc of services) {
    const p = pricing[svc]?.inputUsdPerMillion;
    if (p != null) prices.push(p);
  }
  if (prices.length === 0) return "—";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return `$${min.toFixed(2)}/M in`;
  return `$${min.toFixed(2)} – $${max.toFixed(2)}/M in`;
}

function SortLink({
  col,
  current,
  service,
  active7d,
  children,
}: {
  col: ProviderSortKey;
  current: ProviderSortKey;
  service: string;
  active7d: boolean;
  children: React.ReactNode;
}) {
  const active = col === current;
  const params = new URLSearchParams();
  params.set("sort", col);
  if (service) params.set("service", service);
  if (active7d) params.set("active7d", "1");
  return (
    <a
      href={`?${params.toString()}`}
      className={`hover:text-ink ${active ? "text-ink font-semibold underline underline-offset-2" : "text-muted"}`}
    >
      {children}
    </a>
  );
}

export default async function ProvidersPage({
  searchParams,
}: {
  searchParams: {
    sort?: string;
    service?: string;
    active7d?: string;
  };
}) {
  const sort = (SORT_KEYS.includes(searchParams.sort as ProviderSortKey)
    ? searchParams.sort
    : "volume") as ProviderSortKey;
  const service = searchParams.service ?? "";
  const active7d = searchParams.active7d === "1";

  // Resolve canonical service key (?service=) to its raw aliases via facets.
  // We have to await facets before listProviders so the filter can expand
  // "claude-opus-4-6" into every advertised variant string.
  const facets = await listProviderFacets();
  const { totalCount, activeCount } = facets;

  let serviceAliases: string[] | undefined;
  if (service) {
    const match = facets.serviceGroups.find((g) => g.key === service);
    // Fallback: an unknown key (e.g. bookmarked old URL) passes through as a
    // single-element alias list so the filter still matches the literal string.
    serviceAliases = match ? match.aliases : [service];
  }

  const providersRaw = await listProviders({
    sort,
    serviceAliases,
    active7d,
  });

  // Compute trust score per row from on-chain events (lib/reputation.ts).
  // Mirrors AntSeed's canonical formula. SQL pre-sorts by volume as a proxy
  // when sort=reputation; the final ordering happens here.
  const providers = providersRaw.map((p) => ({
    ...p,
    trust: computeTrust(p),
  }));
  if (sort === "reputation") {
    providers.sort(
      (a, b) => (b.trust?.score ?? -1) - (a.trust?.score ?? -1),
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Provider Directory</h1>
        <p className="text-muted text-sm mt-1">
          AntSeed AI service providers on Base, refreshed hourly from{" "}
          <span className="font-mono text-xs">network.antseed.com</span>
        </p>
      </div>

      <FilterBar
        sort={sort}
        service={service}
        active7d={active7d}
        serviceGroups={facets.serviceGroups}
        activeCount={activeCount}
        totalCount={totalCount}
      />

      {providers.length === 0 ? (
        <div className="panel p-10 text-center text-sm text-muted">
          No providers match the current filters.
        </div>
      ) : (
        <section className="panel overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Services</th>
                <th>Price (input)</th>
                <th className="text-right">
                  <SortLink
                    col="sessions"
                    current={sort}
                    service={service}
                    active7d={active7d}
                  >
                    Sessions
                  </SortLink>
                </th>
                <th className="text-right">
                  <SortLink
                    col="volume"
                    current={sort}
                    service={service}
                    active7d={active7d}
                  >
                    Volume
                  </SortLink>
                </th>
                <th className="text-right">
                  <SortLink
                    col="ghost"
                    current={sort}
                    service={service}
                    active7d={active7d}
                  >
                    Ghost rate
                  </SortLink>
                </th>
                <th title="Computed from on-chain events using AntSeed's canonical formula (channels × volume × ticketBonus × recencyGate). Range 0–100.">
                  <SortLink
                    col="reputation"
                    current={sort}
                    service={service}
                    active7d={active7d}
                  >
                    Reputation
                  </SortLink>
                </th>
                <th title="First on-chain settlement (closest proxy for registration date)">
                  <SortLink
                    col="joined"
                    current={sort}
                    service={service}
                    active7d={active7d}
                  >
                    Joined
                  </SortLink>
                </th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => {
                const rate = ghostRate(p);
                const rep = reputationBadge(p.trust?.score ?? null);
                return (
                  <tr key={p.address}>
                    <td>
                      <Link
                        href={`/sellers/${p.address}`}
                        className="text-accent hover:underline font-medium"
                      >
                        {p.displayName ?? shortAddr(p.address)}
                      </Link>
                      {p.displayName && (
                        <div className="font-mono text-xs text-muted">
                          {shortAddr(p.address)}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {p.services.slice(0, 3).map((svc) => (
                          <Link
                            key={svc}
                            href={`/services/${encodeURIComponent(svc)}`}
                            className="badge badge-muted text-[10px] hover:underline"
                          >
                            {svc}
                          </Link>
                        ))}
                        {p.services.length > 3 && (
                          <span className="badge badge-muted text-[10px]">
                            +{p.services.length - 3}
                          </span>
                        )}
                        {p.services.length === 0 && (
                          <span className="text-muted text-xs">—</span>
                        )}
                      </div>
                    </td>
                    <td className="font-mono text-xs text-muted">
                      {fmtPrice(p.pricing, p.services)}
                    </td>
                    <td className="text-right font-mono text-sm">
                      {fmtNum(p.sessionCount)}
                    </td>
                    <td className="text-right font-mono text-sm">
                      {fmtUsd(p.totalVolumeUsdc)}
                    </td>
                    <td className={`text-right text-sm ${ghostRateClass(rate)}`}>
                      {rate !== null
                        ? `${(rate * 100).toFixed(0)}%`
                        : "—"}
                    </td>
                    <td>
                      <span
                        className={`${rep.cls} text-[10px]`}
                        title={trustTooltip(p.trust)}
                      >
                        {rep.label}
                        {p.trust && (
                          <span className="ml-1 font-mono text-muted">
                            {p.trust.score.toFixed(0)}
                          </span>
                        )}
                      </span>
                    </td>
                    <td
                      className="text-muted text-xs"
                      title="First on-chain settlement"
                    >
                      {p.firstSettledTs ? fmtRelative(p.firstSettledTs) : "—"}
                    </td>
                    <td className="text-muted text-xs">
                      {p.updatedAt
                        ? fmtRelative(Math.floor(p.updatedAt / 1000))
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <p className="text-xs text-muted">
        {providers.length} provider{providers.length !== 1 ? "s" : ""}
        {(service || active7d) && ` (filtered from ${totalCount})`} ·{" "}
        ghost rate = channels closed with $0 settled / total closed channels ·{" "}
        Joined = first on-chain settlement ·{" "}
        Reputation computed from on-chain events using{" "}
        <a
          href="https://github.com/antseed/antseed/blob/main/packages/node/src/reputation/on-chain-reputation.ts"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-ink"
        >
          AntSeed's canonical formula
        </a>
      </p>
    </div>
  );
}
