import Link from "next/link";
import { listSellers, countSellers, lookupProviders } from "@/lib/queries";
import { fmtNum, fmtUsd, shortAddr } from "@/lib/format";
import TimestampDisplay from "../components/TimestampDisplay";
import SortableHeader from "../components/SortableHeader";
import VerifiedLabel from "../components/VerifiedLabel";

export const dynamic = "force-dynamic";

interface SP {
  page?: string;
  sort?: string;
  dir?: string;
}

const SORTS = new Set(["volume", "sessions", "buyers", "ghosts", "first_seen"]);

function pageParam(value: string | undefined): number {
  const n = Number(value ?? 1);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
}

export default async function SellersPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const query = await searchParams;
  const page = pageParam(query.page);
  const limit = 25;
  const offset = (page - 1) * limit;
  const sortParam = query.sort || "volume";
  const sort = SORTS.has(sortParam) ? (sortParam as any) : "volume";
  const dir = query.dir === "asc" ? "asc" : "desc";

  const [rows, total] = await Promise.all([
    listSellers({ limit, offset, sort, dir }),
    countSellers(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const providerMap = await lookupProviders(rows.map((r) => r.address));

  function pageHref(p: number) {
    const sp = new URLSearchParams();
    sp.set("page", String(p));
    if (sort !== "volume") sp.set("sort", sort);
    if (dir !== "desc") sp.set("dir", dir);
    return `/sellers?${sp.toString()}`;
  }

  const sharedParams: Record<string, string> = {};

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Seller Leaderboard
          </h1>
          <p className="text-muted text-sm mt-1">
            {fmtNum(total)} sellers on the network.
          </p>
        </div>
        <a
          href={`/api/sellers?format=csv&sort=${sort}&dir=${dir}`}
          className="btn text-xs"
          download
        >
          ↓ CSV
        </a>
      </div>

      {/* Desktop table */}
      <div className="panel hidden sm:block">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            No sellers indexed yet.
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
                    basePath="/sellers"
                    extraParams={sharedParams}
                  >
                    USDC earned
                  </SortableHeader>
                </th>
                <th>
                  <SortableHeader
                    field="sessions"
                    current={sort}
                    dir={dir}
                    basePath="/sellers"
                    extraParams={sharedParams}
                  >
                    Sessions
                  </SortableHeader>
                </th>
                <th>
                  <SortableHeader
                    field="buyers"
                    current={sort}
                    dir={dir}
                    basePath="/sellers"
                    extraParams={sharedParams}
                  >
                    Buyers
                  </SortableHeader>
                </th>
                <th>
                  <SortableHeader
                    field="ghosts"
                    current={sort}
                    dir={dir}
                    basePath="/sellers"
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
                    basePath="/sellers"
                    extraParams={sharedParams}
                    defaultDir="asc"
                  >
                    First seen
                  </SortableHeader>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={s.address}>
                  <td className="text-muted">{offset + i + 1}</td>
                  <td>
                    <Link
                      href={`/sellers/${s.address}`}
                      className="font-mono text-accent hover:underline"
                    >
                      {shortAddr(s.address)}
                    </Link>
                    <VerifiedLabel
                      displayName={providerMap.get(s.address)?.display_name ?? null}
                    />
                  </td>
                  <td>{fmtUsd(s.total_earned_usdc)}</td>
                  <td>{fmtNum(s.total_sessions)}</td>
                  <td>{fmtNum(s.unique_buyers)}</td>
                  <td
                    className={
                      s.ghost_sessions > 0 ? "text-bad" : "text-muted"
                    }
                  >
                    {fmtNum(s.ghost_sessions)}
                  </td>
                  <td className="text-muted"><TimestampDisplay ts={s.first_seen_ts} dateOnly /></td>
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
            No sellers indexed yet.
          </div>
        ) : (
          rows.map((s, i) => {
            const provider = providerMap.get(s.address);
            return (
              <div key={s.address} className="panel p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs text-muted mr-2">#{offset + i + 1}</span>
                    <Link
                      href={`/sellers/${s.address}`}
                      className="font-mono text-accent hover:underline text-sm"
                    >
                      {provider?.display_name ?? shortAddr(s.address)}
                    </Link>
                    {provider?.display_name && (
                      <div className="font-mono text-xs text-muted">{shortAddr(s.address)}</div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div>
                    <span className="text-muted text-xs">Earned </span>
                    <span className="font-medium">{fmtUsd(s.total_earned_usdc)}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs">Sessions </span>
                    <span>{fmtNum(s.total_sessions)}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs">Buyers </span>
                    <span>{fmtNum(s.unique_buyers)}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs">Ghosts </span>
                    <span className={s.ghost_sessions > 0 ? "text-bad" : "text-muted"}>
                      {fmtNum(s.ghost_sessions)}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-muted">
                  First seen: <TimestampDisplay ts={s.first_seen_ts} dateOnly />
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
