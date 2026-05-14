import Link from "next/link";
import {
  getDailyTokens,
  getDailyVolume,
  getHeroSparklines,
  getHeroStats,
  getHourlyTokens,
  getHourlyVolume,
  getNetworkStats,
  getRecentEvents,
  listBuyers,
} from "@/lib/queries";
import {
  fmtCompact,
  fmtNum,
  fmtRelative,
  fmtUsd,
  pctDelta,
  shortAddr,
} from "@/lib/format";
import { ScoreBadge, QualifiedBadge } from "./components/Badges";
import { TokensChart, VolumeChart } from "./components/Charts";
import HeroCard from "./components/HeroCard";
import Sparkline from "./components/Sparkline";
import TimeRangePills from "./components/TimeRangePills";
import ActivityFeed from "./components/ActivityFeed";
import AutoRefresh from "./components/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  // No page-load sync on Vercel — cron handles indexing.
  // Serialized — Promise.all of multiple Neon HTTP queries occasionally
  // returns empty rows on cold-start serverless invocations.
  const range = searchParams.range || "30d";
  const rangeLabel =
    range === "24h"
      ? "last 24h"
      : range === "7d"
      ? "last 7d"
      : range === "all"
      ? "all time"
      : "last 30d";

  const stats = await getNetworkStats();
  const hero = await getHeroStats();
  const sparks = await getHeroSparklines();
  const revenueSpark = sparks.map((p) => ({ x: p.day, y: p.revenue }));
  const tokensSpark = sparks.map((p) => ({ x: p.day, y: p.tokens }));
  const usersSpark = sparks.map((p) => ({ x: p.day, y: p.paying_users }));
  const daily =
    range === "24h"
      ? await getHourlyVolume(24)
      : range === "7d"
      ? await getDailyVolume(7)
      : range === "all"
      ? await getDailyVolume(9999)
      : await getDailyVolume(30);
  const tokens =
    range === "24h"
      ? await getHourlyTokens(24)
      : range === "7d"
      ? await getDailyTokens(7)
      : range === "all"
      ? await getDailyTokens(9999)
      : await getDailyTokens(30);
  const recent = await getRecentEvents(20);
  const top = await listBuyers({ limit: 10, sort: "score" });

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
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <HeroCard
          label="Network Revenue"
          value={fmtUsd(hero.totalRevenueUsdc)}
          sublabel="Settled USDC, all-time"
          delta={pctDelta(hero.recentRevenueUsdc, hero.priorRevenueUsdc)}
          tooltip="Sum of delta from every ChannelSettled event."
          sparkline={<Sparkline data={revenueSpark} />}
        />
        <HeroCard
          label="Tokens Consumed"
          value={fmtCompact(hero.totalTokens)}
          sublabel={`${fmtCompact(hero.totalTokensInput)} in · ${fmtCompact(
            hero.totalTokensOutput,
          )} out`}
          delta={pctDelta(hero.recentTokens, hero.priorTokens)}
          tooltip="Input + output tokens recorded by AntseedStats — the canonical per-inference accounting."
          sparkline={<Sparkline data={tokensSpark} color="#5fb4d8" />}
        />
        <HeroCard
          label="Paying Users"
          value={fmtNum(hero.totalPayingUsers)}
          sublabel={
            <>
              {fmtNum(hero.usdcPayers)} paid USDC ·{" "}
              <Link
                href="/holders"
                className="text-accent hover:underline underline-offset-2"
              >
                {fmtNum(hero.antHolders)} hold $ANT
              </Link>
            </>
          }
          delta={pctDelta(hero.recentPayingUsers, hero.priorPayingUsers)}
          tooltip="Distinct addresses that either paid USDC into a channel or currently hold $ANT (excluding protocol contracts)."
          sparkline={<Sparkline data={usersSpark} color="#f5b656" />}
        />
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Tokens consumed — {rangeLabel}</h2>
            <TimeRangePills current={range} basePath="/" />
          </div>
          <TokensChart data={tokens} />
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
