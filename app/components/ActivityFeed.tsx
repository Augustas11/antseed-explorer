import Link from "next/link";
import type { RecentEventRow } from "@/lib/queries";
import { fmtRelative, fmtUsd, shortAddr } from "@/lib/format";

function eventPillClass(type: string) {
  if (type === "settled") return "text-accent";
  if (type === "Closed" || type === "closed") return "text-muted";
  if (type === "Reserved" || type === "reserved") return "text-ink";
  return "text-bad"; // ghost / unknown
}

export default function ActivityFeed({ events }: { events: RecentEventRow[] }) {
  if (events.length === 0) return null;
  return (
    <section className="panel">
      <div className="px-4 py-3 border-b border-edge">
        <h2 className="font-medium">Recent activity</h2>
      </div>
      <ul className="divide-y divide-edge/40">
        {events.map((e) => {
          const amount = e.delta_usdc ?? e.settled_amount_usdc;
          return (
            <li
              key={`${e.tx_hash}-${e.log_index}`}
              className="px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-panel/60 transition-colors"
            >
              <span
                className="text-muted text-xs w-16 shrink-0 text-right"
                title={
                  e.timestamp
                    ? new Date(e.timestamp * 1000).toISOString()
                    : ""
                }
              >
                {fmtRelative(e.timestamp)}
              </span>
              <span
                className={`pill text-xs shrink-0 ${eventPillClass(e.event_type)}`}
              >
                {e.event_type}
              </span>
              {e.buyer_address && (
                <Link
                  href={`/buyers/${e.buyer_address}`}
                  className="font-mono text-xs text-accent hover:underline shrink-0"
                >
                  {shortAddr(e.buyer_address)}
                </Link>
              )}
              <span className="text-muted text-xs">→</span>
              {e.seller_address && (
                <Link
                  href={`/sellers/${e.seller_address}`}
                  className="font-mono text-xs text-accent hover:underline shrink-0"
                >
                  {shortAddr(e.seller_address)}
                </Link>
              )}
              {amount != null && amount > 0 && (
                <span className="text-ink text-xs ml-auto shrink-0">
                  {fmtUsd(amount)}
                </span>
              )}
              {e.channel_id && (
                <Link
                  href={`/channels/${e.channel_id}`}
                  className="font-mono text-xs text-muted hover:text-ink shrink-0 truncate max-w-[80px]"
                >
                  {e.channel_id.slice(0, 10)}…
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
