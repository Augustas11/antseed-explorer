import Link from "next/link";
import { listChannels, countChannels, lookupProviders } from "@/lib/queries";
import { fmtNum, fmtUsd, shortAddr } from "@/lib/format";
import SortableHeader from "../components/SortableHeader";
import TimestampDisplay from "../components/TimestampDisplay";
import VerifiedLabel from "../components/VerifiedLabel";

export const dynamic = "force-dynamic";

interface SP {
  page?: string;
  sort?: string;
  dir?: string;
}

const SORTS = new Set(["amount", "settled", "events", "opened", "last_activity"]);

function pageParam(value: string | undefined): number {
  const n = Number(value ?? 1);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
}

function statePillClass(state: "Open" | "Settled" | "Created") {
  if (state === "Open") return "text-accent";
  if (state === "Settled") return "text-muted";
  return "";
}

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const query = await searchParams;
  const page = pageParam(query.page);
  const limit = 25;
  const offset = (page - 1) * limit;
  const sortParam = query.sort || "opened";
  const sort = (SORTS.has(sortParam) ? sortParam : "opened") as
    | "amount"
    | "settled"
    | "events"
    | "opened"
    | "last_activity";
  const dir = query.dir === "asc" ? "asc" : "desc";

  const [rows, total] = await Promise.all([
    listChannels({ limit, offset, sort, dir }),
    countChannels(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const allAddrs = rows
    .flatMap((r) => [r.buyer_address, r.seller_address])
    .filter(Boolean) as string[];
  const providerMap = await lookupProviders(allAddrs);

  function pageHref(p: number) {
    const sp = new URLSearchParams();
    sp.set("page", String(p));
    if (sort !== "opened") sp.set("sort", sort);
    if (dir !== "desc") sp.set("dir", dir);
    return `/channels?${sp.toString()}`;
  }

  const sharedParams: Record<string, string> = {};

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
          <p className="text-muted text-sm mt-1">
            {fmtNum(total)} channels indexed.
          </p>
        </div>
        <a
          href={`/api/channels?format=csv&sort=${sort}&dir=${dir}`}
          className="btn text-xs"
          download
        >
          ↓ CSV
        </a>
      </div>

      {/* Desktop table */}
      <div className="panel overflow-x-auto hidden sm:block">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            No channels indexed yet.
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Channel</th>
                <th>State</th>
                <th>Buyer</th>
                <th>Seller</th>
                <th>
                  <SortableHeader
                    field="opened"
                    current={sort}
                    dir={dir}
                    basePath="/channels"
                    extraParams={sharedParams}
                    defaultDir="desc"
                  >
                    Opened
                  </SortableHeader>
                </th>
                <th>
                  <SortableHeader
                    field="last_activity"
                    current={sort}
                    dir={dir}
                    basePath="/channels"
                    extraParams={sharedParams}
                    defaultDir="desc"
                  >
                    Last activity
                  </SortableHeader>
                </th>
                <th>
                  <SortableHeader
                    field="amount"
                    current={sort}
                    dir={dir}
                    basePath="/channels"
                    extraParams={sharedParams}
                  >
                    Max amount
                  </SortableHeader>
                </th>
                <th>
                  <SortableHeader
                    field="settled"
                    current={sort}
                    dir={dir}
                    basePath="/channels"
                    extraParams={sharedParams}
                  >
                    Settled
                  </SortableHeader>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.channel_id}>
                  <td>
                    <Link
                      href={`/channels/${c.channel_id}`}
                      className="font-mono text-accent hover:underline text-xs"
                    >
                      {c.channel_id.slice(0, 10)}…{c.channel_id.slice(-6)}
                    </Link>
                  </td>
                  <td>
                    <span className={`pill text-xs ${statePillClass(c.state)}`}>
                      {c.state}
                    </span>
                  </td>
                  <td>
                    {c.buyer_address ? (
                      <>
                        <Link
                          href={`/buyers/${c.buyer_address}`}
                          className="font-mono text-xs text-accent hover:underline"
                        >
                          {shortAddr(c.buyer_address)}
                        </Link>
                        <VerifiedLabel
                          displayName={
                            providerMap.get(c.buyer_address)?.display_name ??
                            null
                          }
                        />
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    {c.seller_address ? (
                      <>
                        <Link
                          href={`/sellers/${c.seller_address}`}
                          className="font-mono text-xs text-accent hover:underline"
                        >
                          {shortAddr(c.seller_address)}
                        </Link>
                        <VerifiedLabel
                          displayName={
                            providerMap.get(c.seller_address)?.display_name ??
                            null
                          }
                        />
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="text-muted text-xs"><TimestampDisplay ts={c.opened_ts} dateOnly /></td>
                  <td className="text-muted text-xs"><TimestampDisplay ts={c.last_ts} dateOnly /></td>
                  <td>
                    {c.max_amount_usdc != null ? (
                      fmtUsd(c.max_amount_usdc)
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    {c.settled_amount_usdc != null ? (
                      fmtUsd(c.settled_amount_usdc)
                    ) : (
                      <span className="text-muted">—</span>
                    )}
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
            No channels indexed yet.
          </div>
        ) : (
          rows.map((c) => (
            <div key={c.channel_id} className="panel p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/channels/${c.channel_id}`}
                  className="font-mono text-accent hover:underline text-xs"
                >
                  {c.channel_id.slice(0, 10)}…{c.channel_id.slice(-6)}
                </Link>
                <span className={`pill text-xs shrink-0 ${statePillClass(c.state)}`}>
                  {c.state}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div>
                  <span className="text-muted text-xs">Buyer </span>
                  {c.buyer_address ? (
                    <Link
                      href={`/buyers/${c.buyer_address}`}
                      className="font-mono text-xs text-accent hover:underline"
                    >
                      {shortAddr(c.buyer_address)}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </div>
                <div>
                  <span className="text-muted text-xs">Seller </span>
                  {c.seller_address ? (
                    <Link
                      href={`/sellers/${c.seller_address}`}
                      className="font-mono text-xs text-accent hover:underline"
                    >
                      {shortAddr(c.seller_address)}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </div>
                <div>
                  <span className="text-muted text-xs">Max </span>
                  <span>{c.max_amount_usdc != null ? fmtUsd(c.max_amount_usdc) : "—"}</span>
                </div>
                <div>
                  <span className="text-muted text-xs">Settled </span>
                  <span>{c.settled_amount_usdc != null ? fmtUsd(c.settled_amount_usdc) : "—"}</span>
                </div>
              </div>
              <div className="text-xs text-muted">
                Opened: <TimestampDisplay ts={c.opened_ts} dateOnly />
                {c.last_ts !== c.opened_ts && (
                  <span> · Last: <TimestampDisplay ts={c.last_ts} dateOnly /></span>
                )}
              </div>
            </div>
          ))
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
            className={`btn ${
              page === totalPages ? "opacity-40 pointer-events-none" : ""
            }`}
          >
            Next →
          </Link>
        </div>
      )}
    </div>
  );
}
