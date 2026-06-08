import Link from "next/link";
import { listBuyers, countBuyers, lookupProviders } from "@/lib/queries";
import { fmtNum, fmtUsd, shortAddr } from "@/lib/format";
import TimestampDisplay from "../components/TimestampDisplay";
import { ScoreBadge, QualifiedBadge } from "../components/Badges";
import SortableHeader from "../components/SortableHeader";
import VerifiedLabel from "../components/VerifiedLabel";

export const dynamic = "force-dynamic";

interface SP {
  page?: string;
  qualified?: string;
  minScore?: string;
  sort?: string;
  dir?: string;
}

const sortLabels: Record<string, string> = {
  volume: "USDC volume",
  sessions: "sessions",
  first_seen: "first seen",
  unique_sellers: "seller diversity",
  ghosts: "ghost sessions",
  score: "trust score",
};

const SORTS = new Set(Object.keys(sortLabels));

function pageParam(value: string | undefined): number {
  const n = Number(value ?? 1);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
}

function scoreParam(value: string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

export default async function BuyersPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const query = await searchParams;
  const page = pageParam(query.page);
  const limit = 25;
  const offset = (page - 1) * limit;
  const qualifiedOnly = query.qualified === "1";
  const minScore = scoreParam(query.minScore);
  const sortParam = query.sort || "volume";
  const sort = SORTS.has(sortParam) ? (sortParam as any) : "volume";
  const dir = query.dir === "asc" ? "asc" : "desc";

  const [rows, total] = await Promise.all([
    listBuyers({ limit, offset, qualifiedOnly, minScore, sort }),
    countBuyers({ qualifiedOnly, minScore }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const providerMap = await lookupProviders(rows.map((r) => r.address));

  function pageHref(p: number) {
    const sp = new URLSearchParams();
    sp.set("page", String(p));
    if (qualifiedOnly) sp.set("qualified", "1");
    if (minScore) sp.set("minScore", String(minScore));
    if (sort !== "volume") sp.set("sort", sort);
    if (dir !== "desc") sp.set("dir", dir);
    return `/buyers?${sp.toString()}`;
  }

  const sortLabel = sortLabels[sort] ?? sort;

  const sharedParams: Record<string, string> = {};
  if (qualifiedOnly) sharedParams.qualified = "1";
  if (minScore) sharedParams.minScore = String(minScore);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Top {fmtNum(total)} buyers — sort by {sortLabel}
          </h1>
          <p className="text-muted text-sm mt-1">
            {fmtNum(total)} buyers match this filter.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/api/buyers?format=csv&sort=${sort}`}
            className="btn text-xs"
            download
          >
            ↓ CSV
          </a>
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
            <button className="btn" type="submit">
              Apply
            </button>
          </form>
        </div>
      </div>

      {/* Desktop table */}
      <div className="panel hidden sm:block">
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
                <th>
                  <SortableHeader
                    field="volume"
                    current={sort}
                    dir={dir}
                    basePath="/buyers"
                    extraParams={sharedParams}
                  >
                    USDC
                  </SortableHeader>
                </th>
                <th>
                  <SortableHeader
                    field="sessions"
                    current={sort}
                    dir={dir}
                    basePath="/buyers"
                    extraParams={sharedParams}
                  >
                    Sessions
                  </SortableHeader>
                </th>
                <th>
                  <SortableHeader
                    field="unique_sellers"
                    current={sort}
                    dir={dir}
                    basePath="/buyers"
                    extraParams={sharedParams}
                  >
                    Sellers
                  </SortableHeader>
                </th>
                <th>
                  <SortableHeader
                    field="ghosts"
                    current={sort}
                    dir={dir}
                    basePath="/buyers"
                    extraParams={sharedParams}
                  >
                    Ghosts
                  </SortableHeader>
                </th>
                <th>
                  <SortableHeader
                    field="first_seen"
                    current={sort}
                    dir={dir}
                    basePath="/buyers"
                    extraParams={sharedParams}
                    defaultDir="asc"
                  >
                    First seen
                  </SortableHeader>
                </th>
                <th>
                  <span className="inline-flex items-center gap-2">
                    <SortableHeader
                      field="score"
                      current={sort}
                      dir={dir}
                      basePath="/buyers"
                      extraParams={sharedParams}
                    >
                      Trust
                    </SortableHeader>
                    <Link href="/score" className="text-accent hover:underline">
                      ?
                    </Link>
                  </span>
                </th>
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
                    <VerifiedLabel
                      displayName={providerMap.get(b.address)?.display_name ?? null}
                    />
                  </td>
                  <td>{fmtUsd(b.total_settled_usdc)}</td>
                  <td>{fmtNum(b.total_sessions)}</td>
                  <td>{fmtNum(b.unique_sellers)}</td>
                  <td className={b.ghost_sessions > 0 ? "text-bad" : "text-muted"}>
                    {fmtNum(b.ghost_sessions)}
                  </td>
                  <td className="text-muted"><TimestampDisplay ts={b.first_seen_ts} dateOnly /></td>
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

      {/* Mobile cards */}
      <div className="sm:hidden space-y-2">
        {rows.length === 0 ? (
          <div className="panel p-8 text-center text-muted text-sm">
            No buyers match. Try a lower min score or unqualified.
          </div>
        ) : (
          rows.map((b, i) => {
            const provider = providerMap.get(b.address);
            return (
              <div key={b.address} className="panel p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs text-muted mr-2">#{offset + i + 1}</span>
                    <Link
                      href={`/buyers/${b.address}`}
                      className="font-mono text-accent hover:underline text-sm"
                    >
                      {shortAddr(b.address)}
                    </Link>
                    {provider?.display_name && (
                      <VerifiedLabel displayName={provider.display_name} />
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <ScoreBadge score={b.trust_score} />
                    <QualifiedBadge qualified={!!b.qualified} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div>
                    <span className="text-muted text-xs">USDC </span>
                    <span className="font-medium">{fmtUsd(b.total_settled_usdc)}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs">Sessions </span>
                    <span>{fmtNum(b.total_sessions)}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs">Sellers </span>
                    <span>{fmtNum(b.unique_sellers)}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs">Ghosts </span>
                    <span className={b.ghost_sessions > 0 ? "text-bad" : "text-muted"}>
                      {fmtNum(b.ghost_sessions)}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-muted">
                  First seen: <TimestampDisplay ts={b.first_seen_ts} dateOnly />
                </div>
              </div>
            );
          })
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
