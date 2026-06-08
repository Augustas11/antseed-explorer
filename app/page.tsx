import Link from "next/link";
import type { Metadata } from "next";
import {
  getDailyTokens,
  getDailyVolume,
  getDailyMetricsTable,
  getHeroSnapshot,
  getHourlyTokens,
  getHourlyVolume,
  getEpochAnalytics,
  getNetworkStats,
  getRecentEvents,
  listBuyers,
} from "@/lib/queries";
import { getEpochClock } from "@/lib/epoch";
import {
  fmtCompact,
  fmtNum,
  fmtRelative,
  fmtUsd,
  pctDelta,
  shortAddr,
} from "@/lib/format";
import { ScoreBadge, QualifiedBadge } from "./components/Badges";
import { EpochRevenueChart, TokensChart, VolumeChart } from "./components/Charts";
import { DauChart } from "./components/DauChart";
import EpochCountdown from "./components/EpochCountdown";
import HeroCard from "./components/HeroCard";
import Sparkline from "./components/Sparkline";
import TimeRangePills from "./components/TimeRangePills";
import ActivityFeed from "./components/ActivityFeed";
import AutoRefresh from "./components/AutoRefresh";
import { getHeroSnapshotStatus } from "@/lib/heroSnapshot";
import { getSiteOrigin, siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const title = "AntSeed Demand Explorer";
  const description = "On-chain buyer intelligence for the AntSeed P2P AI network";
  const siteOrigin = await getSiteOrigin();

  const stats = await getNetworkStats().catch(() => null);
  const imageUrl = stats ? homeOgImageUrl(siteOrigin, stats) : siteUrl(siteOrigin, "/og/home");
  // Production should set NEXT_PUBLIC_SITE_URL=https://www.antfeed.org so X sees
  // one canonical cache identity; previews and local dev fall back to request
  // headers so their metadata remains fetchable.
  const homeUrl = siteUrl(siteOrigin, "/");
  const image = {
    url: imageUrl,
    width: 1200,
    height: 630,
    alt: "AntSeed Demand Explorer — latest on-chain buyer intelligence metrics",
  };

  return {
    title,
    description,
    alternates: { canonical: homeUrl },
    openGraph: {
      title,
      description,
      type: "website",
      url: homeUrl,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; days?: string }>;
}) {
  // No page-load sync on Vercel — cron handles indexing.
  const query = await searchParams;
  const range = query.range || "30d";
  const dailyMetricDays = Math.max(14, Math.min(90, Number(query.days) || 14));
  const rangeLabel =
    range === "24h"
      ? "last 24h"
      : range === "7d"
      ? "last 7d"
      : range === "all"
      ? "all time"
      : "last 30d";

  // Hero cards read one DB-cached snapshot. Missing or corrupt snapshots render
  // as unavailable instead of false zeroes; cron refreshes the cache off-path.
  const dailyP =
    range === "24h"
      ? getHourlyVolume(24)
      : range === "7d"
      ? getDailyVolume(7)
      : range === "all"
      ? getDailyVolume(9999)
      : getDailyVolume(30);
  const tokensP =
    range === "24h"
      ? getHourlyTokens(24)
      : range === "7d"
      ? getDailyTokens(7)
      : range === "all"
      ? getDailyTokens(9999)
      : getDailyTokens(30);
  const epochClockP = getEpochClock();
  const [stats, heroSnapshot, daily, tokens, dailyMetrics, recent, top, epochClock] = await Promise.all([
    getNetworkStats(),
    getHeroSnapshot(),
    dailyP,
    tokensP,
    getDailyMetricsTable(dailyMetricDays),
    getRecentEvents(20),
    listBuyers({ limit: 10, sort: "score" }),
    epochClockP,
  ]);
  const epoch = await getEpochAnalytics(epochClock);
  const hero = heroSnapshot?.stats ?? null;
  const heroStatus = heroSnapshot ? getHeroSnapshotStatus(heroSnapshot) : null;
  const heroStale = heroStatus?.stale === true;
  const sparks = heroSnapshot?.sparklines ?? [];
  const revenueSpark = sparks.map((p) => ({ x: p.day, y: p.revenue }));
  const tokensSpark = sparks.map((p) => ({ x: p.day, y: p.tokens }));
  const usersSpark = sparks.map((p) => ({ x: p.day, y: p.paying_users }));
  const snapshotPending = "Snapshot pending refresh";
  const snapshotStatus = heroStale ? "Snapshot stale; refresh pending" : snapshotPending;

  const isMock = !!process.env.SEED_MODE;

  return (
    <div className="space-y-8">
      {isMock && (
        <div className="panel border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
          DEMO DATA — this database was populated by the seed script.
          Run a real sync to replace it.
        </div>
      )}

      <section>
        <h1 className="text-3xl font-semibold tracking-tight">
          AntSeed network economics
        </h1>
        <p className="text-muted mt-2 max-w-2xl">
          Settled USDC, tokens consumed, and paying users on the AntSeed P2P AI
          services network. All metrics derived from on-chain events on Base.
        </p>
        <Link
          href="/mcp"
          className="inline-flex items-center gap-2 mt-4 px-3 py-1.5 rounded-full border border-accent/30 bg-accent/5 text-xs text-accent hover:bg-accent/10 transition-colors"
        >
          <span className="font-medium">Use from any AI agent</span>
          <span className="text-muted">— one-line MCP install</span>
          <span aria-hidden="true">→</span>
        </Link>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <HeroCard
          label="Network Revenue"
          value={hero ? fmtUsd(hero.totalRevenueUsdc) : "—"}
          sublabel={hero ? (heroStale ? snapshotStatus : "Settled USDC, all-time") : snapshotPending}
          delta={hero ? pctDelta(hero.recentRevenueUsdc, hero.priorRevenueUsdc) : null}
          tooltip="Sum of delta from every ChannelSettled event."
          sparkline={<Sparkline data={revenueSpark} />}
        />
        <HeroCard
          label="Tokens Consumed"
          value={hero ? fmtCompact(hero.totalTokens) : "—"}
          sublabel={
            hero
              ? `${fmtCompact(hero.totalTokensInput)} in · ${fmtCompact(
                  hero.totalTokensOutput,
                )} out${heroStale ? " · stale" : ""}`
              : snapshotPending
          }
          delta={hero ? pctDelta(hero.recentTokens, hero.priorTokens) : null}
          tooltip="Input + output tokens recorded by AntseedStats — the canonical per-inference accounting."
          sparkline={<Sparkline data={tokensSpark} color="#5fb4d8" />}
        />
        <HeroCard
          label="Paying Users"
          value={hero ? `${hero.diemExactAddresses ? "" : "~"}${fmtNum(hero.totalPayingUsers)}` : "—"}
          sublabel={
            hero ? (
              <>
                {fmtNum(hero.usdcPayers)} paid USDC ·{" "}
                {fmtNum(hero.antsClaimers)} claimed $ANTS
                {" · "}
                <a
                  href="https://diem.antseed.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline underline-offset-2"
                >
                  {fmtNum(hero.diemPoolUsers)} in DIEM
                </a>
                {heroStale ? " · stale" : ""}
              </>
            ) : (
              snapshotPending
            )
          }
          delta={hero ? pctDelta(hero.recentPayingUsers, hero.priorPayingUsers) : null}
          tooltip={
            hero?.diemExactAddresses === false
              ? "Approximate wallets across deposited USDC, claimed $ANTS, and DIEM. DIEM currently provides a count only, so DIEM wallets cannot be de-duplicated against the other groups."
              : "Unique wallets across three groups: deposited USDC, claimed $ANTS, or active in the DIEM pool. The three sub-counts can overlap — a wallet that did two of those things is counted once in the total but once in each sub-count."
          }
          sparkline={<Sparkline data={usersSpark} color="#f5b656" />}
        />
      </section>

      <section className="panel px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-medium text-ink">Current epoch #{epoch.currentEpoch}</span>
          <span className="text-muted">·</span>
          <span>
            ends in{" "}
            <span className="text-ink">
              <EpochCountdown endTs={epoch.endTs} initialNow={Date.now()} />
            </span>
          </span>
          <span className="text-muted">·</span>
          <span>
            epoch revenue <span className="text-ink">{fmtUsd(epoch.epochRevenueUsdc)}</span>
          </span>
          <span className="text-muted">·</span>
          <span>
            active sellers <span className="text-ink">{fmtNum(epoch.activeSellers)}</span>
          </span>
          {epoch.todo && (
            <span className="text-xs text-muted">
              · 7-day boundary fallback
            </span>
          )}
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Network revenue — {rangeLabel}</h2>
            <TimeRangePills current={range} basePath="/" />
          </div>
          <VolumeChart data={daily} />
        </div>
        <div className="panel p-4">
          <div className="mb-3">
            <h2 className="font-medium">Epoch revenue</h2>
            <p className="text-xs text-muted mt-0.5">
              Settled USDC by reward epoch.
            </p>
          </div>
          <EpochRevenueChart data={epoch.buckets} />
        </div>
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Tokens consumed — {rangeLabel}</h2>
            <TimeRangePills current={range} basePath="/" />
          </div>
          <TokensChart data={tokens} />
        </div>
      </section>

      <section>
        <DauChart />
      </section>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 p-4 border-b border-edge">
          <div>
            <h2 className="font-medium">Daily metrics</h2>
            <p className="text-xs text-muted mt-0.5">
              UTC daily demand, settlement, and token usage.
            </p>
          </div>
          {dailyMetricDays < 90 && (
            <Link
              href={`/?${new URLSearchParams({ range, days: "90" }).toString()}`}
              className="text-xs text-accent hover:underline shrink-0"
            >
              Show more →
            </Link>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>DAU</th>
                <th>New users</th>
                <th>Settled USDC</th>
                <th>Fees</th>
                <th>Settles</th>
                <th>Requests</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {dailyMetrics.map((row) => (
                <tr key={row.day}>
                  <td className="font-mono text-xs text-muted">{row.day}</td>
                  <td>{fmtNum(row.dau)}</td>
                  <td>{fmtNum(row.newUsers)}</td>
                  <td>{fmtUsd(row.settledUsdc)}</td>
                  <td>{fmtUsd(row.feesUsdc)}</td>
                  <td>{fmtNum(row.settles)}</td>
                  <td>{fmtNum(row.requests)}</td>
                  <td>{fmtCompact(row.tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ActivityFeed events={recent} />

      <section className="panel">
        <div className="flex items-center justify-between p-4 border-b border-edge">
          <h2 className="font-medium">Top 10 buyers by Trust Score</h2>
          <Link href="/buyers" className="text-xs text-accent hover:underline">
            view full leaderboard →
          </Link>
        </div>
        {top.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            No buyers indexed yet — data syncs automatically every 5 minutes.
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Address</th>
                <th>USDC</th>
                <th>Sessions</th>
                <th>Sellers</th>
                <th>Trust</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {top.map((b, i) => (
                <tr key={b.address}>
                  <td className="text-muted">{i + 1}</td>
                  <td>
                    <Link
                      href={`/buyers/${b.address}`}
                      className="font-mono text-accent hover:underline"
                    >
                      {shortAddr(b.address)}
                    </Link>
                  </td>
                  <td>{fmtUsd(b.total_settled_usdc)}</td>
                  <td>{fmtNum(b.total_sessions)}</td>
                  <td>{fmtNum(b.unique_sellers)}</td>
                  <td>
                    <ScoreBadge score={b.trust_score} />
                  </td>
                  <td>
                    <QualifiedBadge qualified={!!b.qualified} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <AutoRefresh intervalMs={60_000} />

      <section className="text-xs text-muted flex flex-wrap items-center gap-2">
        {(() => {
          const ageMs = stats.lastSyncTs ? Date.now() - stats.lastSyncTs : null;
          const dotCls =
            ageMs == null
              ? "bg-muted"
              : ageMs < 10 * 60 * 1000
              ? "bg-accent"
              : ageMs < 60 * 60 * 1000
              ? "bg-warn"
              : "bg-bad";
          return (
            <>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotCls}`} />
              <span>
                Updated{" "}
                <span className="text-ink">
                  {stats.lastSyncTs
                    ? fmtRelative(Math.floor(stats.lastSyncTs / 1000))
                    : "—"}
                </span>
              </span>
              <span>· Auto-syncs every 5 minutes</span>
            </>
          );
        })()}
      </section>
    </div>
  );
}

function homeOgImageUrl(
  siteOrigin: string,
  stats: Awaited<ReturnType<typeof getNetworkStats>>,
): string {
  const params = new URLSearchParams({
    buyers: String(stats.totalBuyers),
    usdc: String(stats.totalVolumeUsdc),
    sessions: String(stats.totalSessions),
    v: String(
      stats.lastSyncTs ??
        `${stats.totalBuyers}-${stats.totalVolumeUsdc}-${stats.totalSessions}`,
    ),
  });
  return `${siteUrl(siteOrigin, "/og/home")}?${params.toString()}`;
}
