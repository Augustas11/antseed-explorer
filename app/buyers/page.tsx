import Link from "next/link";
import { listBuyers, countBuyers } from "@/lib/queries";
import { fmtNum, fmtUsd, fmtDate, shortAddr } from "@/lib/format";
import { ScoreBadge, QualifiedBadge } from "../components/Badges";

export const dynamic = "force-dynamic";

interface SP {
  page?: string;
  qualified?: string;
  minScore?: string;
  sort?: string;
}

export default async function BuyersPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const page = Math.max(1, Number(searchParams.page || 1));
  const limit = 25;
  const offset = (page - 1) * limit;
  const qualifiedOnly = searchParams.qualified === "1";
  const minScore = Number(searchParams.minScore || 0);
  const sort = (searchParams.sort || "score") as any;

  const [rows, total] = await Promise.all([
    listBuyers({ limit, offset, qualifiedOnly, minScore, sort }),
    countBuyers({ qualifiedOnly, minScore }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  function pageHref(p: number) {
    const sp = new URLSearchParams();
    sp.set("page", String(p));
    if (qualifiedOnly) sp.set("qualified", "1");
    if (minScore) sp.set("minScore", String(minScore));
    if (sort !== "score") sp.set("sort", sort);
    return `/buyers?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Buyer Leaderboard
          </h1>
          <p className="text-muted text-sm mt-1">
            {fmtNum(total)} buyers match this filter.
          </p>
        </div>
        <form className="flex items-center gap-3" method="get">
          <label className="text-xs text-muted flex items-center gap-2">
            <input
              type="checkbox"
              name="qualified"
              value="1"
              defaultChecked={qualifiedOnly}
              className="accent-accent"
            />
            Qualified only
          </label>
          <label className="text-xs text-muted flex items-center gap-2">
            min score
            <input
              type="number"
              name="minScore"
              defaultValue={minScore || ""}
              placeholder="0"
              min={0}
              max={100}
              className="w-16 bg-panel border border-edge rounded px-2 py-1 text-ink"
            />
          </label>
          <select
            name="sort"
            defaultValue={sort}
            className="bg-panel border border-edge rounded px-2 py-1 text-xs"
          >
            <option value="score">sort: trust</option>
            <option value="volume">sort: volume</option>
            <option value="sessions">sort: sessions</option>
            <option value="first_seen">sort: first seen</option>
          </select>
          <button className="btn" type="submit">
            Apply
          </button>
        </form>
      </div>

      <div className="panel">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            No buyers match. Try a lower min score or unqualified.
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
                <th>Ghosts</th>
                <th>First seen</th>
                <th>Trust</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b, i) => (
                <tr key={b.address}>
                  <td className="text-muted">{offset + i + 1}</td>
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
                  <td className={b.ghost_sessions > 0 ? "text-bad" : "text-muted"}>
                    {fmtNum(b.ghost_sessions)}
                  </td>
                  <td className="text-muted">{fmtDate(b.first_seen_ts)}</td>
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
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Link
            href={pageHref(Math.max(1, page - 1))}
            aria-disabled={page === 1}
            className={`btn ${page === 1 ? "opacity-40 pointer-events-none" : ""}`}
          >
            ← Prev
          </Link>
          <span className="text-muted">
            Page <span className="text-ink">{page}</span> of {totalPages}
          </span>
          <Link
            href={pageHref(Math.min(totalPages, page + 1))}
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
