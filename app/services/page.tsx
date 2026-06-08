import Link from "next/link";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { listServices, listServicesFlat } from "@/lib/queries";
import { fmtNum } from "@/lib/format";
import { getLabForModel, type Lab } from "@/lib/labs";
import MarketplaceTable from "../components/MarketplaceTable";

export const dynamic = "force-dynamic";

const MARKETPLACE_UX = process.env.MARKETPLACE_UX === "true";
const getLogoSvg = cache(async (fileName: string) => {
  const svgPath = path.join(process.cwd(), "public", "labs", fileName);
  return readFile(svgPath, "utf8");
});

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (MARKETPLACE_UX) {
    const rows = await listServicesFlat();
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Available Services
          </h1>
          <p className="text-muted text-sm mt-1">
            AI services on the AntSeed network.
          </p>
        </div>
        <MarketplaceTable rows={rows} />
      </div>
    );
  }

  const query = await searchParams;
  const view = query.view === "table" ? "table" : "grid";
  const services = await listServices();
  const labsByService = new Map(services.map((service) => [service.name, getLabForModel(service.display)]));
  const logoFiles = [...new Set([...labsByService.values()].map((lab) => lab.logo))];
  const logoPairs = await Promise.all(
    logoFiles.map(async (fileName) => [fileName, await getLogoSvg(fileName)] as const),
  );
  const logos = new Map<string, string>(logoPairs);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Service Browser
        </h1>
        <p className="text-muted text-sm mt-1">
          AI models on the AntSeed network. Spelling variants of the same model
          ("Claude Opus 4.6" / "claude-opus-4-6") are rolled up into one row.
        </p>
      </div>

      <div className="flex items-center gap-1 rounded border border-edge bg-panel p-1 w-fit">
        <Link
          href="/services"
          className={`px-3 py-1.5 rounded text-xs transition-colors ${
            view === "grid" ? "bg-accent/15 text-accent" : "text-muted hover:text-ink"
          }`}
        >
          Grid
        </Link>
        <Link
          href="/services?view=table"
          className={`px-3 py-1.5 rounded text-xs transition-colors ${
            view === "table" ? "bg-accent/15 text-accent" : "text-muted hover:text-ink"
          }`}
        >
          Table
        </Link>
      </div>

      {view === "grid" ? (
        <ServiceCatalogGrid services={services} labsByService={labsByService} logos={logos} />
      ) : (
      <div className="panel">
        {services.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            No services in provider directory yet.
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Model</th>
                <th>Providers</th>
                <th>Input $/M (min – max)</th>
                <th>Output $/M (min – max)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.name}>
                  <td>
                    <span className="text-ink">{s.display}</span>
                    {s.aliases.length > 1 && (
                      <span
                        className="badge badge-muted ml-2 text-[10px]"
                        title={`Rolls up: ${s.aliases.join(", ")}`}
                      >
                        {s.aliases.length}× aliases
                      </span>
                    )}
                  </td>
                  <td>{fmtNum(s.provider_count)}</td>
                  <td className="text-muted text-xs">
                    {s.min_price_in != null
                      ? `$${s.min_price_in.toFixed(2)} – $${(s.max_price_in ?? s.min_price_in).toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="text-muted text-xs">
                    {s.min_price_out != null
                      ? `$${s.min_price_out.toFixed(2)} – $${(s.max_price_out ?? s.min_price_out).toFixed(2)}`
                      : "—"}
                  </td>
                  <td>
                    <Link
                      href={`/services/${encodeURIComponent(s.name)}`}
                      className="text-xs text-accent hover:underline"
                    >
                      View providers →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}
    </div>
  );
}

function fmtPrice(value: number | null): string {
  return value == null ? "—" : `$${value.toFixed(2)}`;
}

function ServiceCatalogGrid({
  services,
  labsByService,
  logos,
}: {
  services: Awaited<ReturnType<typeof listServices>>;
  labsByService: Map<string, Lab>;
  logos: Map<string, string>;
}) {
  if (services.length === 0) {
    return (
      <div className="panel p-8 text-center text-muted text-sm">
        No services in provider directory yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {services.map((service) => {
        const lab = labsByService.get(service.name) ?? getLabForModel(service.display);
        const svg = logos.get(lab.logo);
        return (
          <article key={service.name} className="panel p-4 space-y-4">
            <div className="flex items-start gap-3">
              <div
                className="h-11 w-11 shrink-0 text-accent"
                aria-hidden="true"
                dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
              />
              <div className="min-w-0">
                <div className="text-xs text-muted">{lab.name}</div>
                <h2 className="font-medium text-ink truncate" title={service.display}>
                  {service.display}
                </h2>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-xs text-muted">Input $/M</div>
                <div className="font-medium">{fmtPrice(service.min_price_in)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Output $/M</div>
                <div className="font-medium">{fmtPrice(service.min_price_out)}</div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted">
                {fmtNum(service.provider_count)} seller{service.provider_count === 1 ? "" : "s"}
              </span>
              <Link
                href={`/services/${encodeURIComponent(service.name)}#mcp`}
                className="text-xs text-accent hover:underline"
              >
                Use via MCP →
              </Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}
