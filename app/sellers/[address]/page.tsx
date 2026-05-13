import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getSeller,
  getSellerMonthlyVolume,
  getSellerBuyerSummary,
  lookupProvider as lookupProviderFn,
  lookupProviders,
} from "@/lib/queries";
import { explorerBaseUrl } from "@/lib/chain";
import { fmtNum, fmtUsd, shortAddr } from "@/lib/format";
import { MonthlyVolumeChart } from "../../components/Charts";
import AddressDisplay from "../../components/AddressDisplay";
import TimestampDisplay from "../../components/TimestampDisplay";
import VerifiedLabel from "../../components/VerifiedLabel";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { address: string };
}): Promise<Metadata> {
  const seller = await getSeller(params.address).catch(() => null);
  const short = shortAddr(params.address);
  if (!seller) {
    return {
      title: `Seller ${short} — not indexed | AntSeed Explorer`,
    };
  }
  return {
    title: `Seller ${short} — ${fmtUsd(seller.total_earned_usdc)} earned | AntSeed Explorer`,
    description: `Seller on AntSeed P2P AI network. Earned ${fmtUsd(seller.total_earned_usdc)} USDC across ${fmtNum(seller.total_sessions)} sessions for ${fmtNum(seller.unique_buyers)} unique buyers.`,
  };
}

export default async function SellerProfilePage({
  params,
}: {
  params: { address: string };
}) {
  const seller = await getSeller(params.address);
  if (!seller) notFound();

  const [monthly, topBuyers, provider] = await Promise.all([
    getSellerMonthlyVolume(seller.address).catch((e) => { console.error("getSellerMonthlyVolume failed:", e); return []; }),
    getSellerBuyerSummary(seller.address, 10).catch((e) => { console.error("getSellerBuyerSummary failed:", e); return []; }),
    lookupProviderFn(seller.address).catch((e) => { console.error("lookupProvider failed:", e); return null; }),
  ]);
  const buyerMap = await lookupProviders(topBuyers.map((b) => b.buyer_address)).catch(() => new Map());

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

      {monthly.length > 0 && (
        <section className="panel p-4">
          <h2 className="font-medium mb-3">Activity over time</h2>
          <MonthlyVolumeChart data={monthly as any} />
        </section>
      )}

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
