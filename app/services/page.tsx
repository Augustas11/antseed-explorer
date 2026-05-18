import Link from "next/link";
import { listServices, listServicesFlat } from "@/lib/queries";
import { fmtNum } from "@/lib/format";
import MarketplaceTable from "../components/MarketplaceTable";

export const dynamic = "force-dynamic";

const MARKETPLACE_UX = process.env.MARKETPLACE_UX === "true";

export default async function ServicesPage() {
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

  const services = await listServices();

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
    </div>
  );
}
