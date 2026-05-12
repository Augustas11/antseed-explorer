import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getChannel, getChannelEvents, lookupProviders } from "@/lib/queries";
import { explorerBaseUrl } from "@/lib/chain";
import { fmtDate, fmtNum, fmtUsd, fmtRelative, shortAddr } from "@/lib/format";
import CopyButton from "../../components/CopyButton";
import VerifiedLabel from "../../components/VerifiedLabel";

export const dynamic = "force-dynamic";

function statePillClass(state: "Open" | "Settled" | "Created") {
  if (state === "Open") return "text-accent";
  if (state === "Settled") return "text-muted";
  return "";
}

function eventTypePillClass(type: string) {
  if (type === "settled" || type === "Settled") return "text-accent";
  if (type === "Closed" || type === "closed") return "text-muted";
  if (type === "Reserved" || type === "reserved") return "text-ink";
  return "text-warn";
}

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const channel = await getChannel(params.id).catch(() => null);
  if (!channel)
    return { title: `Channel not found | AntSeed Explorer` };
  const short = `${params.id.slice(0, 10)}…${params.id.slice(-6)}`;
  return {
    title: `Channel ${short} — ${channel.state} | AntSeed Explorer`,
    description: `AntSeed channel between ${shortAddr(channel.buyer_address)} and ${shortAddr(channel.seller_address)}. State: ${channel.state}. Max: ${fmtUsd(channel.max_amount_usdc ?? 0)}.`,
  };
}

export default async function ChannelDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const channel = await getChannel(params.id);
  if (!channel) notFound();

  const events = await getChannelEvents(params.id, 100);

  const addrs = [channel.buyer_address, channel.seller_address].filter(
    Boolean,
  ) as string[];
  const providerMap = await lookupProviders(addrs);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted">
            Channel
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <code className="font-mono text-lg text-ink break-all">
              {params.id}
            </code>
            <CopyButton text={params.id} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className={`pill ${statePillClass(channel.state)}`}>
              {channel.state}
            </span>
            {channel.opened_ts && (
              <span
                className="text-xs text-muted"
                title={new Date(channel.opened_ts * 1000).toISOString()}
              >
                opened {fmtRelative(channel.opened_ts)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Participants + key stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat col-span-2 md:col-span-1">
          <div className="stat-label">Buyer</div>
          <div className="stat-value text-base">
            {channel.buyer_address ? (
              <>
                <Link
                  href={`/buyers/${channel.buyer_address}`}
                  className="font-mono text-accent hover:underline text-sm"
                >
                  {shortAddr(channel.buyer_address)}
                </Link>
                <VerifiedLabel
                  displayName={
                    providerMap.get(channel.buyer_address)?.display_name ?? null
                  }
                />
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
        <div className="stat col-span-2 md:col-span-1">
          <div className="stat-label">Seller</div>
          <div className="stat-value text-base">
            {channel.seller_address ? (
              <>
                <Link
                  href={`/sellers/${channel.seller_address}`}
                  className="font-mono text-accent hover:underline text-sm"
                >
                  {shortAddr(channel.seller_address)}
                </Link>
                <VerifiedLabel
                  displayName={
                    providerMap.get(channel.seller_address)?.display_name ??
                    null
                  }
                />
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Max amount</div>
          <div className="stat-value">
            {channel.max_amount_usdc != null
              ? fmtUsd(channel.max_amount_usdc)
              : "—"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Settled</div>
          <div className="stat-value">
            {channel.settled_amount_usdc != null
              ? fmtUsd(channel.settled_amount_usdc)
              : "—"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Events</div>
          <div className="stat-value">{fmtNum(channel.event_count)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Opened</div>
          <div className="stat-value text-base">
            {fmtDate(channel.opened_ts)}
          </div>
          <div className="text-xs text-muted">
            block {channel.opened_block ?? "—"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Last activity</div>
          <div className="stat-value text-base">{fmtDate(channel.last_ts)}</div>
          <div className="text-xs text-muted">
            block {channel.last_block ?? "—"}
          </div>
        </div>
      </section>

      {/* Event timeline */}
      <section className="panel">
        <div className="px-4 py-3 border-b border-edge">
          <h2 className="font-medium">Event timeline</h2>
          <p className="text-xs text-muted mt-1">
            {events.length} event{events.length !== 1 ? "s" : ""} · ordered
            oldest first
          </p>
        </div>
        {events.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">No events.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Type</th>
                <th>Block</th>
                <th>Date</th>
                <th>USDC</th>
                <th>Tokens (in / out)</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const usdcVal = e.delta_usdc ?? e.settled_amount_usdc;
                return (
                  <tr key={`${e.tx_hash}-${e.log_index}`}>
                    <td>
                      <span
                        className={`pill text-xs ${eventTypePillClass(e.event_type)}`}
                      >
                        {e.event_type}
                      </span>
                    </td>
                    <td className="font-mono text-xs text-muted">
                      {e.block_number}
                    </td>
                    <td className="text-muted text-xs">{fmtDate(e.timestamp)}</td>
                    <td>
                      {usdcVal != null ? (
                        fmtUsd(usdcVal)
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-xs">
                      {e.input_tokens != null || e.output_tokens != null ? (
                        <span>
                          <span className="text-ink">
                            {fmtNum(e.input_tokens)}
                          </span>
                          <span className="text-muted"> / </span>
                          <span className="text-ink">
                            {fmtNum(e.output_tokens)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      <a
                        href={`${explorerBaseUrl}/tx/${e.tx_hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-accent hover:underline font-mono"
                      >
                        {e.tx_hash.slice(0, 10)}… ↗
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <div className="text-xs">
        <Link href="/channels" className="text-accent hover:underline">
          ← back to channels
        </Link>
      </div>
    </div>
  );
}
