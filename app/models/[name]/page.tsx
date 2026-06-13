import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getModelDetail } from "@/lib/queries";
import { fmtUsd, fmtNum, fmtCompact } from "@/lib/format";
import ModelTagChips from "../../components/ModelTagChips";
import ProviderList from "../../components/ProviderList";
import Sparkline from "../../components/Sparkline";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const { name } = await params;
  const input = decodeURIComponent(name);
  const detail = await getModelDetail(input).catch(() => null);
  const title = detail?.display ?? input;
  return {
    title: `${title} — Usage on the network | AntSeed Explorer`,
    description: `Per-model network statistics for ${title} on the AntSeed P2P AI network.`,
  };
}

export default async function ModelDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const input = decodeURIComponent(name);
  const detail = await getModelDetail(input);
  if (!detail) notFound();

  const spendData = detail.daily.map((d) => ({ x: d.day, y: d.amount_usdc }));
  const tokenData = detail.daily.map((d) => ({
    x: d.day,
    y: d.input_tokens + d.output_tokens,
  }));

  return (
    <div className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted">Model</div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1 flex flex-wrap items-baseline gap-3">
          <span>{detail.display}</span>
          <ModelTagChips tags={detail.tags} />
        </h1>
        {detail.lab && detail.lab.id !== "generic" && (
          <p className="text-muted text-sm mt-1">{detail.lab.name}</p>
        )}
      </header>

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="stat">
          <div className="stat-label">Spend</div>
          <div className="stat-value text-base">{fmtUsd(detail.amount_usdc)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Requests</div>
          <div className="stat-value">{fmtNum(detail.requests)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Input tokens</div>
          <div className="stat-value text-base">{fmtCompact(detail.input_tokens)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Output tokens</div>
          <div className="stat-value text-base">{fmtCompact(detail.output_tokens)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Sellers</div>
          <div className="stat-value">{fmtNum(detail.sellers)}</div>
        </div>
      </section>

      {detail.daily.length > 0 && (
        <section className="panel">
          <div className="px-4 py-3 border-b border-edge">
            <h2 className="font-medium text-sm">Last 30 days</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
            <div>
              <div className="text-xs text-muted mb-1">Spend</div>
              <Sparkline data={spendData} />
            </div>
            <div>
              <div className="text-xs text-muted mb-1">Tokens</div>
              <Sparkline data={tokenData} />
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="px-4 py-3 border-b border-edge">
          <h2 className="font-medium">Providers</h2>
          <p className="text-xs text-muted mt-1">
            {fmtNum(detail.provider_count)} provider
            {detail.provider_count !== 1 ? "s" : ""} offering this model.
            {detail.min_price_in != null && (
              <>
                {" "}Input ${detail.min_price_in.toFixed(2)} – ${(detail.max_price_in ?? detail.min_price_in).toFixed(2)} per million,
                output ${detail.min_price_out?.toFixed(2) ?? "0"} – ${(detail.max_price_out ?? detail.min_price_out ?? 0).toFixed(2)} per million.
              </>
            )}
          </p>
        </div>
        <ProviderList
          providers={detail.providers}
          emptyMessage="No providers in the directory yet."
        />
      </section>

      {detail.aliases.length > 1 && (
        <div className="text-xs text-muted">
          Advertised as:{" "}
          {detail.aliases.map((a, i) => (
            <span key={a}>
              {i > 0 && ", "}
              <span className="font-mono">{a}</span>
            </span>
          ))}
        </div>
      )}

      <div className="text-xs flex flex-wrap gap-4">
        <Link
          href={`/services/${encodeURIComponent(detail.service_key)}`}
          className="text-accent hover:underline"
        >
          View supply catalog →
        </Link>
        <Link href="/models" className="text-accent hover:underline">
          ← back to models
        </Link>
      </div>
    </div>
  );
}
