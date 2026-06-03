import Link from "next/link";
import { listHolders, countHolders } from "@/lib/queries";
import { fmtCompact, fmtNum, shortAddr } from "@/lib/format";

export const dynamic = "force-dynamic";

interface SP {
  page?: string;
}

export default async function HoldersPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const query = await searchParams;
  const page = Math.max(1, Number(query.page || 1));
  const limit = 50;
  const offset = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    listHolders({ limit, offset }),
    countHolders(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">$ANTS holders</h1>
        <p className="text-muted text-sm mt-1">
          {total > 0
            ? `${fmtNum(total)} addresses holding $ANTS (liquid or staked). Protocol contracts excluded; %share is of indexed circulating supply.`
            : "Backfill in progress — Transfer and Staking event indexes are still walking forward from deploy blocks. Numbers will populate as the cron catches up."}
        </p>
      </div>

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
                    <Link
                      href={`/buyers/${h.address}`}
                      className="font-mono text-accent hover:underline"
                    >
                      {shortAddr(h.address)}
                    </Link>
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
            href={`/holders?page=${Math.max(1, page - 1)}`}
            aria-disabled={page === 1}
            className={`btn ${page === 1 ? "opacity-40 pointer-events-none" : ""}`}
          >
            ← Prev
          </Link>
          <span className="text-muted">
            Page <span className="text-ink">{page}</span> of {totalPages}
          </span>
          <Link
            href={`/holders?page=${Math.min(totalPages, page + 1)}`}
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
