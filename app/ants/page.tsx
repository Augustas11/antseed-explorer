import Link from "next/link";
import type { Metadata } from "next";
import {
  countHolders,
  getAntsOverview,
  listHolders,
  type HolderRow,
} from "@/lib/queries";
import { explorerBaseUrl } from "@/lib/chain";
import { clampPage, fmtCompact, fmtNum, fmtUsd, shortAddr } from "@/lib/format";
import { AntsSupplyChart } from "../components/Charts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "$ANTS | AntSeed Demand Explorer",
  description: "$ANTS supply, claim, lock, and holder distribution metrics.",
};

interface SP {
  page?: string;
}

export default async function AntsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const query = await searchParams;
  const page = clampPage(query.page);
  const limit = 50;
  const offset = (page - 1) * limit;

  const [rows, total, overview] = await Promise.all([
    listHolders({ limit, offset }),
    countHolders(),
    getAntsOverview(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const claimedLiquid = Math.max(0, overview.claimedAnts - overview.lockedAnts);
  const chartData = [
    {
      name: "Supply",
      minted: overview.mintedAnts,
      available: overview.availableAnts,
    },
    {
      name: "Claims",
      claimed: claimedLiquid,
      locked: overview.lockedAnts,
      unclaimed: overview.unclaimedAnts,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">$ANTS</h1>
        <p className="text-muted text-sm mt-1">
          {total > 0
            ? `${fmtNum(total)} addresses holding $ANTS (liquid or staked). Protocol contracts excluded; %share is of indexed circulating supply.`
            : "Backfill in progress — Transfer and Staking event indexes are still walking forward from deploy blocks. Numbers will populate as the cron catches up."}
        </p>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <MetricCard
          label="Minted"
          value={`${fmtCompact(overview.mintedAnts)} / ${fmtCompact(overview.maxSupplyAnts)} max`}
        />
        <MetricCard
          label="Claimed"
          value={fmtCompact(overview.claimedAnts)}
          sub={`${fmtNum(overview.claimedAccounts)} accounts`}
        />
        <MetricCard label="Locked (seller rewards)" value={fmtCompact(overview.lockedAnts)} />
        <MetricCard label="Treasury" value={fmtUsd(overview.treasuryUsdc)} />
      </section>

      <section className="panel p-4 space-y-3">
        <p className="text-sm text-muted max-w-3xl">
          AntSeed routes the 10% operator fee on DIEM revenue into a treasury intended
          for $ANTS buybacks once transfers are enabled. Until then, the explorer
          tracks claimed emissions, seller-reward locks, and indexed holder balances.
        </p>
        <AntsSupplyChart data={chartData} />
      </section>

      <div className="panel">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-muted text-sm">
            No holders indexed yet.
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Address</th>
                <th className="text-right">$ANTS (liquid)</th>
                <th className="text-right">Staked</th>
                <th className="text-right">% supply</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h, i) => (
                <tr key={h.address}>
                  <td className="text-muted">{offset + i + 1}</td>
                  <td>
                    <HolderAddressLink holder={h} />
                  </td>
                  <td className="text-right tabular-nums">
                    {fmtCompact(h.balance_ants)}
                  </td>
                  <td className="text-right tabular-nums text-muted">
                    {h.staked_balance_ants > 0 ? fmtCompact(h.staked_balance_ants) : "—"}
                  </td>
                  <td className="text-right tabular-nums text-muted">
                    {h.pct_supply.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Link
            href={`/ants?page=${Math.max(1, page - 1)}`}
            aria-disabled={page === 1}
            className={`btn ${page === 1 ? "opacity-40 pointer-events-none" : ""}`}
          >
            ← Prev
          </Link>
          <span className="text-muted">
            Page <span className="text-ink">{page}</span> of {totalPages}
          </span>
          <Link
            href={`/ants?page=${Math.min(totalPages, page + 1)}`}
            aria-disabled={page === totalPages}
            className={`btn ${page === totalPages ? "opacity-40 pointer-events-none" : ""}`}
          >
            Next →
          </Link>
        </div>
      )}
    </div>
  );
}

function HolderAddressLink({ holder }: { holder: HolderRow }) {
  const className = "font-mono text-accent hover:underline";
  const label = shortAddr(holder.address);
  if (holder.kind === "buyer") {
    return (
      <Link href={`/buyers/${holder.address}`} className={className}>
        {label}
      </Link>
    );
  }
  if (holder.kind === "seller") {
    return (
      <Link href={`/sellers/${holder.address}`} className={className}>
        {label}
      </Link>
    );
  }
  return (
    <a
      href={`${explorerBaseUrl}/address/${holder.address}`}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </a>
  );
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  );
}
