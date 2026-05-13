import type { Metadata } from "next";
import Link from "next/link";
import { listProviders, type DirectoryProviderRow } from "@/lib/queries";
import { fmtUsd, fmtNum, fmtRelative, shortAddr } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Provider Directory | AntSeed Explorer",
  description:
    "AntSeed AI service providers on Base, updated hourly from network.antseed.com",
};

type SortKey = "volume" | "sessions" | "ghost";

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
  children,
}: {
  col: SortKey;
  current: SortKey;
  children: React.ReactNode;
}) {
  const active = col === current;
  return (
    <a
      href={`?sort=${col}`}
      className={`hover:text-ink ${active ? "text-ink font-semibold underline underline-offset-2" : "text-muted"}`}
    >
      {children}
    </a>
  );
}

export default async function ProvidersPage({
  searchParams,
}: {
  searchParams: { sort?: string };
}) {
  const sort = (["volume", "sessions", "ghost"].includes(searchParams.sort ?? "")
    ? searchParams.sort
    : "volume") as SortKey;

  const providers = await listProviders({ sort });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Provider Directory</h1>
        <p className="text-muted text-sm mt-1">
          AntSeed AI service providers on Base, refreshed hourly from{" "}
          <span className="font-mono text-xs">network.antseed.com</span>
        </p>
      </div>

      {providers.length === 0 ? (
        <div className="panel p-10 text-center text-sm text-muted">
          No providers indexed yet. Provider data is refreshed hourly during
          each sync.
        </div>
      ) : (
        <section className="panel overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Region</th>
                <th>Services</th>
                <th>Price (input)</th>
                <th className="text-right">
                  <SortLink col="sessions" current={sort}>
                    Sessions
                  </SortLink>
                </th>
                <th className="text-right">
                  <SortLink col="volume" current={sort}>
                    Volume
                  </SortLink>
                </th>
                <th className="text-right">
                  <SortLink col="ghost" current={sort}>
                    Ghost rate
                  </SortLink>
                </th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => {
                const rate = ghostRate(p);
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
                    <td className="text-muted text-xs">{p.region ?? "—"}</td>
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
        {providers.length} provider{providers.length !== 1 ? "s" : ""} ·{" "}
        ghost rate = channels closed with $0 settled / total closed channels
      </p>
    </div>
  );
}
