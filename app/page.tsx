import Link from "next/link";
import {
  getDailyVolume,
  getNetworkStats,
  listBuyers,
} from "@/lib/queries";
import { fmtNum, fmtRelative, fmtUsd, shortAddr } from "@/lib/format";
import { ScoreBadge, QualifiedBadge } from "./components/Badges";
import { ActiveBuyersChart, VolumeChart } from "./components/Charts";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // No page-load sync on Vercel — cron handles indexing.
  // Serialized — Promise.all of multiple Neon HTTP queries occasionally
  // returns empty rows on cold-start serverless invocations.
  const stats = await getNetworkStats();
  const daily = await getDailyVolume(30);
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
          On-chain buyer intelligence
        </h1>
        <p className="text-muted mt-2 max-w-2xl">
          Indexed buyer activity from the AntSeed P2P AI services network on
          Base. Profiles, demand signals, and a Buyer Trust Score derived from
          on-chain settlement data.
        </p>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat">
          <div className="stat-label">Buyers indexed</div>
          <div className="stat-value">{fmtNum(stats.totalBuyers)}</div>
          <div className="text-xs text-muted">
            {fmtNum(stats.qualifiedBuyers)} qualified
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">USDC settled</div>
          <div className="stat-value">{fmtUsd(stats.totalVolumeUsdc)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Sessions settled</div>
          <div className="stat-value">{fmtNum(stats.totalSessions)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Ghost sessions</div>
          <div className="stat-value">{fmtNum(stats.totalGhosts)}</div>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Settlement volume — last 30d</h2>
            <span className="pill">USDC / day</span>
          </div>
          <VolumeChart data={daily} />
        </div>
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Active buyers — last 30d</h2>
            <span className="pill">unique addresses</span>
          </div>
          <ActiveBuyersChart data={daily} />
        </div>
      </section>

      <section className="panel">
        <div className="flex items-center justify-between p-4 border-b border-edge">
          <h2 className="font-medium">Top 10 buyers by Trust Score</h2>
          <Link href="/buyers" className="text-xs text-accent hover:underline">
            view full leaderboard →
          </Link>
        </div>
        {top.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            No buyers indexed yet. Hit <span className="text-ink">Sync now</span>{" "}
            (top right) to trigger an indexing pass, or wait for the next cron tick.
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

      <section className="text-xs text-muted flex flex-wrap items-center gap-3">
        <span>
          Last sync:{" "}
          <span className="text-ink">{fmtRelative(stats.lastSyncTs ? Math.floor(stats.lastSyncTs / 1000) : null)}</span>
        </span>
        <span>·</span>
        <span>
          Last indexed block:{" "}
          <span className="text-ink font-mono">
            {stats.lastIndexedBlock ?? "—"}
          </span>
        </span>
        {stats.lastIndexedBlock != null && stats.lastHeadBlock != null && (() => {
          const gap = stats.lastHeadBlock - stats.lastIndexedBlock;
          if (gap <= 50) return null;
          const hours = Math.round((gap * 2) / 3600);
          const cls = gap > 5000 ? "text-bad" : "text-warn";
          return (
            <>
              <span>·</span>
              <span className={cls}>
                ⚠ Behind chain head by{" "}
                <span className="font-mono">{gap.toLocaleString()}</span>{" "}
                blocks ({hours > 0 ? `~${hours}h` : "<1h"}). Next cron tick will catch up.
              </span>
            </>
          );
        })()}
      </section>
    </div>
  );
}
