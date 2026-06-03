import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getBuyer,
  getBuyerDailyVolume,
  getBuyerHourlyVolume,
  getBuyerSessions,
  getBuyerSellerSummary,
  lookupProviders,
  type ProviderRow,
} from "@/lib/queries";
import { calculateTrustScore } from "@/lib/score";
import { explorerBaseUrl } from "@/lib/chain";
import { fmtNum, fmtUsd, shortAddr } from "@/lib/format";
import { ScoreBadge, QualifiedBadge } from "../../components/Badges";
import { ActivityChart } from "../../components/Charts";
import TimeRangePills from "../../components/TimeRangePills";
import AddressDisplay from "../../components/AddressDisplay";
import TimestampDisplay from "../../components/TimestampDisplay";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  const buyer = await getBuyer(address).catch(() => null);
  const short = shortAddr(address);
  if (!buyer) {
    return {
      title: `Buyer ${short} — not indexed | AntSeed Demand Explorer`,
      description: `No on-chain activity indexed for ${short} on the AntSeed P2P AI services network.`,
    };
  }
  const qualified = buyer.qualified ? "Qualified" : "Not qualified";
  const title = `Buyer ${short} — Trust ${Math.round(buyer.trust_score)} | AntSeed Demand Explorer`;
  const description = `${qualified} buyer on the AntSeed P2P AI network. Settled ${fmtUsd(buyer.total_settled_usdc)} USDC across ${fmtNum(buyer.total_sessions)} sessions with ${fmtNum(buyer.unique_sellers)} sellers.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "profile" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function BuyerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const [{ address }, query] = await Promise.all([params, searchParams]);
  const buyer = await getBuyer(address);
  if (!buyer) notFound();

  const breakdown = calculateTrustScore({
    address: buyer.address,
    totalSessions: buyer.total_sessions,
    totalSettledUsdc: buyer.total_settled_usdc,
    uniqueSellers: buyer.unique_sellers,
    ghostSessions: buyer.ghost_sessions,
  });

  const range = query.range || "30d";
  const rangeLabel =
    range === "24h"
      ? "last 24h"
      : range === "7d"
      ? "last 7d"
      : range === "all"
      ? "all time"
      : "last 30d";

  const activityPromise =
    range === "24h"
      ? getBuyerHourlyVolume(buyer.address, 24)
      : range === "7d"
      ? getBuyerDailyVolume(buyer.address, 7)
      : range === "all"
      ? getBuyerDailyVolume(buyer.address, 9999)
      : getBuyerDailyVolume(buyer.address, 30);

  const [sessions, topSellers, activity] = await Promise.all([
    getBuyerSessions(buyer.address, 50).catch((e) => { console.error("getBuyerSessions failed:", e); return []; }),
    getBuyerSellerSummary(buyer.address, 10).catch((e) => { console.error("getBuyerSellerSummary failed:", e); return []; }),
    activityPromise.catch((e) => { console.error("getBuyer activity failed:", e); return []; }),
  ]);
  const providerMap = await lookupProviders([
    ...sessions.map((s) => s.seller_address),
    ...topSellers.map((s) => s.seller_address),
  ]).catch(() => new Map());
  const lookupProvider = (a: string | null | undefined): ProviderRow | null =>
    a ? providerMap.get(a) ?? null : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted">
            Buyer profile
          </div>
          <div className="mt-1">
            <AddressDisplay address={buyer.address} full />
          </div>
          <div className="mt-1">
            <a
              className="text-xs text-accent hover:underline"
              href={`${explorerBaseUrl}/address/${buyer.address}`}
              target="_blank"
              rel="noreferrer"
            >
              Basescan ↗
            </a>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <QualifiedBadge qualified={!!buyer.qualified} />
            {buyer.ghost_sessions > 0 && (
              <span className="badge badge-bad">
                {buyer.ghost_sessions} ghost{buyer.ghost_sessions > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs uppercase tracking-wider text-muted mb-2">
            Trust Score
          </div>
          <ScoreBadge score={buyer.trust_score} size="lg" />
        </div>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat">
          <div className="stat-label">Total spent</div>
          <div className="stat-value">{fmtUsd(buyer.total_settled_usdc)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Sessions</div>
          <div className="stat-value">{fmtNum(buyer.total_sessions)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Unique sellers</div>
          <div className="stat-value">{fmtNum(buyer.unique_sellers)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Ghost sessions</div>
          <div
            className={`stat-value ${buyer.ghost_sessions > 0 ? "text-bad" : ""}`}
          >
            {fmtNum(buyer.ghost_sessions)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">First active</div>
          <div className="stat-value text-base">
            <TimestampDisplay ts={buyer.first_seen_ts} dateOnly />
          </div>
          <div className="text-xs text-muted">block {buyer.first_seen_block ?? "—"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Last active</div>
          <div className="stat-value text-base">
            <TimestampDisplay ts={buyer.last_seen_ts} dateOnly />
          </div>
          <div className="text-xs text-muted">block {buyer.last_seen_block ?? "—"}</div>
        </div>
        <div className="stat col-span-2">
          <div className="stat-label">Score breakdown</div>
          <div className="grid grid-cols-4 gap-2 mt-1 text-sm">
            <Sub label="Volume" value={breakdown.volume} max={30} />
            <Sub label="Consistency" value={breakdown.consistency} max={25} />
            <Sub label="Diversity" value={breakdown.diversity} max={25} />
            <Sub label="Reliability" value={breakdown.reliability} max={20} />
          </div>
        </div>
      </section>

      <section className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Activity over time — {rangeLabel}</h2>
          <TimeRangePills current={range} basePath={`/buyers/${buyer.address}`} />
        </div>
        {activity.length > 0 ? (
          <ActivityChart data={activity} />
        ) : (
          <div className="py-10 text-center text-sm text-muted">
            No activity in this range.
          </div>
        )}
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="panel">
          <div className="px-4 py-3 border-b border-edge">
            <h2 className="font-medium">Top sellers used</h2>
            <p className="text-xs text-muted mt-1">
              Token totals are from validated on-chain records.
              Services are what each peer currently advertises on
              network.antseed.com — likely candidates for what was served.
            </p>
          </div>
          {topSellers.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted">
              No settled sessions.
            </div>
          ) : (
            <ul className="divide-y divide-edge/60">
              {topSellers.map((s) => {
                const provider = lookupProvider(s.seller_address);
                return (
                  <li key={s.seller_address} className="p-4 space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <div>
                        {provider?.display_name ? (
                          <span className="text-ink font-medium">
                            {provider.display_name}
                          </span>
                        ) : (
                          <span className="text-muted">unknown peer</span>
                        )}{" "}
                        <span className="font-mono text-xs text-muted">
                          {shortAddr(s.seller_address)}
                        </span>
                        {provider?.region && provider.region !== "unknown" && (
                          <span className="ml-2 pill">{provider.region}</span>
                        )}
                      </div>
                      <div className="text-right text-sm">
                        <div className="text-ink">{fmtUsd(s.total_usdc)}</div>
                        <div className="text-xs text-muted">
                          {fmtNum(s.sessions)} session{s.sessions === 1 ? "" : "s"}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted">
                      <span>
                        in: <span className="text-ink">{fmtNum(s.total_input_tokens)}</span> tok
                      </span>
                      <span>
                        out: <span className="text-ink">{fmtNum(s.total_output_tokens)}</span> tok
                      </span>
                      <span>
                        reqs: <span className="text-ink">{fmtNum(s.total_requests)}</span>
                      </span>
                    </div>

                    {provider?.services && provider.services.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {provider.services.map((svc) => {
                          const px = provider.pricing?.[svc];
                          const tooltip = px
                            ? `in $${px.inputUsdPerMillion}/M · out $${px.outputUsdPerMillion}/M`
                            : undefined;
                          return (
                            <span
                              key={svc}
                              title={tooltip}
                              className="badge badge-muted !text-[11px] cursor-help"
                            >
                              {svc}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-[11px] text-muted italic">
                        no current service listing for this peer
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="panel">
          <h2 className="font-medium px-4 py-3 border-b border-edge">
            Recent sessions
          </h2>
          {sessions.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted">No events.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Seller</th>
                  <th>USDC</th>
                  <th>Tokens (in / out)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const provider = lookupProvider(s.seller_address);
                  const status = mapStatus(s.event_type, s.settled_amount_usdc);
                  return (
                    <tr key={`${s.tx_hash}-${s.log_index}`}>
                      <td className="text-muted"><TimestampDisplay ts={s.timestamp} dateOnly /></td>
                      <td>
                        <span className="font-mono text-xs">
                          {provider?.display_name || shortAddr(s.seller_address)}
                        </span>
                      </td>
                      <td>
                        {fmtUsd(s.delta_usdc || s.settled_amount_usdc || 0)}
                      </td>
                      <td className="text-xs">
                        {s.input_tokens != null || s.output_tokens != null ? (
                          <span>
                            <span className="text-ink">{fmtNum(s.input_tokens)}</span>
                            <span className="text-muted"> / </span>
                            <span className="text-ink">{fmtNum(s.output_tokens)}</span>
                            {s.request_count ? (
                              <span className="text-muted"> · {s.request_count} req</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`pill ${status.cls}`}>
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="text-xs">
        <Link href="/buyers" className="text-accent hover:underline">
          ← back to leaderboard
        </Link>
      </div>
    </div>
  );
}

function Sub({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className="text-ink">
        {value}
        <span className="text-muted text-xs"> / {max}</span>
      </div>
      <div className="h-1 bg-edge rounded mt-1">
        <div
          className="h-1 bg-accent rounded"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function mapStatus(eventType: string, settled: number | null) {
  if (eventType === "settled") return { label: "settled", cls: "" };
  if (eventType === "closed" && (!settled || settled === 0))
    return { label: "ghost", cls: "!text-bad !border-bad/40" };
  if (eventType === "closed") return { label: "closed", cls: "" };
  if (eventType === "reserved") return { label: "open", cls: "" };
  return { label: eventType, cls: "" };
}
