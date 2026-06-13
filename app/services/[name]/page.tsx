import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getService, getModelDetail } from "@/lib/queries";
import { fmtNum } from "@/lib/format";
import AgentSnippet from "../../components/AgentSnippet";
import ProviderList from "../../components/ProviderList";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const { name } = await params;
  const input = decodeURIComponent(name);
  const service = await getService(input);
  const title = service?.display ?? input;
  return {
    title: `${title} — Service details | AntSeed Explorer`,
    description: `Providers offering ${title} on the AntSeed P2P AI network.`,
  };
}

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const input = decodeURIComponent(name);
  const service = await getService(input);
  if (!service) notFound();
  // Show the "View usage stats →" cross-link only when v2 attribution rolled
  // up to a model under this canonical key. getModelDetail returns null when
  // there's no spend attributed yet (pre-v2 sellers, or zero-baseline holdouts).
  const usage = await getModelDetail(service.name).catch(() => null);
  const cheapestProvider = service.provider_details
    .filter((provider) => provider.peer_id)
    .sort((a, b) => {
      const aCost =
        (a.pricing?.inputUsdPerMillion ?? Number.POSITIVE_INFINITY) +
        (a.pricing?.outputUsdPerMillion ?? Number.POSITIVE_INFINITY);
      const bCost =
        (b.pricing?.inputUsdPerMillion ?? Number.POSITIVE_INFINITY) +
        (b.pricing?.outputUsdPerMillion ?? Number.POSITIVE_INFINITY);
      return aCost - bCost;
    })[0];
  const snippetService =
    cheapestProvider?.pricing_service ??
    cheapestProvider?.advertised_as[0] ??
    service.name;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted">
          Model
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">
          {service.display}
        </h1>
        <p className="text-muted text-sm mt-1">
          {fmtNum(service.provider_count)} provider
          {service.provider_count !== 1 ? "s" : ""} offering this model.
        </p>
        {service.aliases.length > 1 && (
          <p className="text-muted text-xs mt-2">
            Advertised as:{" "}
            {service.aliases.map((a, i) => (
              <span key={a}>
                {i > 0 && ", "}
                <span className="font-mono">{a}</span>
              </span>
            ))}
          </p>
        )}
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat">
          <div className="stat-label">Providers</div>
          <div className="stat-value">{fmtNum(service.provider_count)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Input $/M (range)</div>
          <div className="stat-value text-base">
            {service.min_price_in != null
              ? `$${service.min_price_in.toFixed(2)} – $${(service.max_price_in ?? service.min_price_in).toFixed(2)}`
              : "—"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Output $/M (range)</div>
          <div className="stat-value text-base">
            {service.min_price_out != null
              ? `$${service.min_price_out.toFixed(2)} – $${(service.max_price_out ?? service.min_price_out).toFixed(2)}`
              : "—"}
          </div>
        </div>
      </section>

      <AgentSnippet
        peerId={cheapestProvider?.peer_id}
        service={snippetService}
      />

      <section className="panel">
        <div className="px-4 py-3 border-b border-edge">
          <h2 className="font-medium">Providers</h2>
        </div>
        <ProviderList providers={service.provider_details} />
      </section>

      {usage && (
        <div className="text-xs">
          <Link
            href={`/models/${encodeURIComponent(service.name)}`}
            className="text-accent hover:underline"
          >
            View usage stats →
          </Link>
        </div>
      )}

      <div className="text-xs">
        <Link href="/services" className="text-accent hover:underline">
          ← back to services
        </Link>
      </div>
    </div>
  );
}
