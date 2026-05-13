import Link from "next/link";
import { listServices } from "@/lib/queries";
import { fmtNum } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const services = await listServices();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Service Browser
        </h1>
        <p className="text-muted text-sm mt-1">
          Distinct AI services advertised by providers on the AntSeed network.
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
                <th>Service name</th>
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
                    <span className="font-mono text-ink">{s.name}</span>
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
