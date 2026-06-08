import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getSeller,
  getSellerDailyVolume,
  getSellerHourlyVolume,
  getSellerBuyerSummary,
  lookupProvider as lookupProviderFn,
  lookupProviders,
} from "@/lib/queries";
import { explorerBaseUrl } from "@/lib/chain";
import { fmtNum, fmtUsd, shortAddr } from "@/lib/format";
import { ActivityChart } from "../../components/Charts";
import TimeRangePills from "../../components/TimeRangePills";
import AddressDisplay from "../../components/AddressDisplay";
import TimestampDisplay from "../../components/TimestampDisplay";
import VerifiedLabel from "../../components/VerifiedLabel";
import AgentSnippet from "../../components/AgentSnippet";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  const [seller, provider] = await Promise.all([
    getSeller(address).catch(() => null),
    lookupProviderFn(address).catch(() => null),
  ]);
  const short = shortAddr(address);
  if (!seller && !provider) {
    return {
      title: `Seller ${short} — not indexed | AntSeed Explorer`,
    };
  }
  const label = provider?.display_name ?? short;
  if (!seller) {
    return {
      title: `${label} — listed, no settled sessions yet | AntSeed Explorer`,
      description: `Provider ${label} is listed in the AntSeed directory but has no settled sessions yet.`,
    };
  }
  return {
    title: `${label} — ${fmtUsd(seller.total_earned_usdc)} earned | AntSeed Explorer`,
    description: `Seller on AntSeed P2P AI network. Earned ${fmtUsd(seller.total_earned_usdc)} USDC across ${fmtNum(seller.total_sessions)} sessions for ${fmtNum(seller.unique_buyers)} unique buyers.`,
  };
}

export default async function SellerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const [{ address }, query] = await Promise.all([params, searchParams]);
  const addrLc = address.toLowerCase();
  const [sellerRaw, provider] = await Promise.all([
    getSeller(address).catch(() => null),
    lookupProviderFn(address).catch((e) => { console.error("lookupProvider failed:", e); return null; }),
  ]);
  if (!sellerRaw && !provider) notFound();

  const seller = sellerRaw ?? {
    address: addrLc,
    unique_buyers: 0,
    total_sessions: 0,
    total_earned_usdc: 0,
    ghost_sessions: 0,
    first_seen_ts: null,
    last_seen_ts: null,
    first_seen_block: null,
    last_seen_block: null,
  };

  const range = query.range || "30d";
  const rangeLabel =
    range === "24h"
      ? "last 24h"
      : range === "7d"
      ? "last 7d"
      : range === "all"
      ? "all time"
      : "last 30d";
  const hasEvents = sellerRaw !== null;
  const activity = !hasEvents
    ? []
    : range === "24h"
      ? await getSellerHourlyVolume(seller.address, 24).catch((e) => { console.error("getSellerHourlyVolume failed:", e); return []; })
      : range === "7d"
      ? await getSellerDailyVolume(seller.address, 7).catch((e) => { console.error("getSellerDailyVolume failed:", e); return []; })
      : range === "all"
      ? await getSellerDailyVolume(seller.address, 9999).catch((e) => { console.error("getSellerDailyVolume failed:", e); return []; })
      : await getSellerDailyVolume(seller.address, 30).catch((e) => { console.error("getSellerDailyVolume failed:", e); return []; });

  const topBuyers = hasEvents
    ? await getSellerBuyerSummary(seller.address, 10).catch((e) => { console.error("getSellerBuyerSummary failed:", e); return []; })
    : [];
  const buyerMap = topBuyers.length > 0
    ? await lookupProviders(topBuyers.map((b) => b.buyer_address)).catch(() => new Map())
    : new Map();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted">
            Seller profile
          </div>
          <div className="mt-1">
            <AddressDisplay address={seller.address} full />
          </div>
          <div className="mt-1">
            <a
              className="text-xs text-accent hover:underline"
              href={`${explorerBaseUrl}/address/${seller.address}`}
              target="_blank"
              rel="noreferrer"
            >
              Basescan ↗
            </a>
          </div>
          {provider?.display_name && (
            <div className="mt-2">
              <span className="pill">{provider.display_name}</span>
              {provider.region && provider.region !== "unknown" && (
                <span className="pill ml-1">{provider.region}</span>
              )}
            </div>
          )}
          {provider?.operator_address && (
            <div className="mt-2 text-xs text-muted">
              Settles via delegation contract — operated by{" "}
              <Link
                className="text-accent hover:underline"
                href={`/sellers/${provider.operator_address}`}
              >
                {shortAddr(provider.operator_address)}
              </Link>
            </div>
          )}
        </div>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat">
          <div className="stat-label">Total earned</div>
          <div className="stat-value">{fmtUsd(seller.total_earned_usdc)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Sessions</div>
          <div className="stat-value">{fmtNum(seller.total_sessions)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Unique buyers</div>
          <div className="stat-value">{fmtNum(seller.unique_buyers)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Ghost sessions</div>
          <div
            className={`stat-value ${seller.ghost_sessions > 0 ? "text-bad" : ""}`}
          >
            {fmtNum(seller.ghost_sessions)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">First active</div>
          <div className="stat-value text-base">
            <TimestampDisplay ts={seller.first_seen_ts} dateOnly />
          </div>
          <div className="text-xs text-muted">
            block {seller.first_seen_block ?? "—"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Last active</div>
          <div className="stat-value text-base">
            <TimestampDisplay ts={seller.last_seen_ts} dateOnly />
          </div>
          <div className="text-xs text-muted">
            block {seller.last_seen_block ?? "—"}
          </div>
        </div>
      </section>

      {provider && (
        <AgentSnippet
          title="Use this seller via your agent"
          peerId={provider.peer_id}
          services={provider.services}
        />
      )}

      <section className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Activity over time — {rangeLabel}</h2>
          <TimeRangePills current={range} basePath={`/sellers/${seller.address}`} />
        </div>
        {activity.length > 0 ? (
          <ActivityChart data={activity} />
        ) : (
          <div className="py-10 text-center text-sm text-muted">
            No activity in this range.
          </div>
        )}
      </section>

      <section className="panel">
        <div className="px-4 py-3 border-b border-edge">
          <h2 className="font-medium">Top buyers served</h2>
        </div>
        {topBuyers.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">
            No settled sessions.
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Buyer</th>
                <th>Sessions</th>
                <th>USDC paid</th>
              </tr>
            </thead>
            <tbody>
              {topBuyers.map((b) => {
                const prov = buyerMap.get(b.buyer_address);
                return (
                  <tr key={b.buyer_address}>
                    <td>
                      <Link
                        href={`/buyers/${b.buyer_address}`}
                        className="font-mono text-accent hover:underline text-xs"
                      >
                        {shortAddr(b.buyer_address)}
                      </Link>
                      <VerifiedLabel
                        displayName={prov?.display_name ?? null}
                      />
                    </td>
                    <td>{fmtNum(b.sessions)}</td>
                    <td>{fmtUsd(b.total_usdc)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {provider?.description && (
        <section className="panel p-4">
          <h2 className="font-medium mb-3">About</h2>
          <div className="text-sm space-y-3 leading-relaxed">
            {renderProviderMarkdown(provider.description)}
          </div>
        </section>
      )}

      {provider?.services && provider.services.length > 0 && (
        <section className="panel p-4">
          <h2 className="font-medium mb-3">Advertised services</h2>
          <div className="flex flex-wrap gap-2">
            {provider.services.map((svc) => {
              const px = provider.pricing?.[svc];
              return (
                <span
                  key={svc}
                  title={
                    px
                      ? `in $${px.inputUsdPerMillion}/M · out $${px.outputUsdPerMillion}/M`
                      : undefined
                  }
                  className="badge badge-muted cursor-help"
                >
                  {svc}
                </span>
              );
            })}
          </div>
        </section>
      )}

      <div className="text-xs">
        <Link href="/sellers" className="text-accent hover:underline">
          ← back to sellers
        </Link>
      </div>
    </div>
  );
}

// Minimal Markdown renderer for the provider About copy. Handles paragraphs,
// bullet lists ("- "), bold ("**foo**"), and links ("[text](url)"). Skips a
// leading "### " heading since the section already renders an <h2>About</h2>.
function renderProviderMarkdown(md: string): React.ReactNode[] {
  const blocks: React.ReactNode[] = [];
  const paragraphs = md.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (p.startsWith("### ")) continue;
    const lines = p.split("\n");
    const firstDash = lines.findIndex((l) => l.trimStart().startsWith("- "));
    const allListAfterFirstDash =
      firstDash >= 0 && lines.slice(firstDash).every((l) => l.trimStart().startsWith("- "));
    if (firstDash === 0 && allListAfterFirstDash) {
      blocks.push(
        <ul key={i} className="list-disc pl-5 space-y-1">
          {lines.map((l, j) => (
            <li key={j}>{renderInlineMd(l.replace(/^\s*-\s+/, ""))}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (firstDash > 0 && allListAfterFirstDash) {
      blocks.push(
        <p key={`${i}-p`}>{renderInlineMd(lines.slice(0, firstDash).join(" "))}</p>,
      );
      blocks.push(
        <ul key={`${i}-ul`} className="list-disc pl-5 space-y-1">
          {lines.slice(firstDash).map((l, j) => (
            <li key={j}>{renderInlineMd(l.replace(/^\s*-\s+/, ""))}</li>
          ))}
        </ul>,
      );
      continue;
    }
    blocks.push(<p key={i}>{renderInlineMd(p.replace(/\n/g, " "))}</p>);
  }
  return blocks;
}

function renderInlineMd(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<strong key={k++}>{m[1]}</strong>);
    } else {
      const href = safeProfileHref(m[3]);
      out.push(href ? (
        <a
          key={k++}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {m[2]}
        </a>
      ) : (
        <span key={k++}>{m[2]}</span>
      ));
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function safeProfileHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return raw;
    }
  } catch {
    // Fall through to rendering the link text as plain text.
  }
  return null;
}
