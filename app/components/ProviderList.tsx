import Link from "next/link";
import { shortAddr } from "@/lib/format";
import VerifiedLabel from "./VerifiedLabel";

interface ProviderDetail {
  address: string;
  display_name: string | null;
  peer_id?: string | null;
  pricing: { inputUsdPerMillion?: number | null; outputUsdPerMillion?: number | null } | null;
  pricing_service?: string | null;
  advertised_as: string[];
}

interface ProviderListProps {
  providers: ProviderDetail[];
  emptyMessage?: string;
}

// Reusable provider-list table shared by /services/[name] (supply catalog) and
// /models/[name] (usage view). Provider count, advertised-as aliases, and the
// per-provider price range come from the supply directory.
export default function ProviderList({
  providers,
  emptyMessage = "No providers found.",
}: ProviderListProps) {
  if (providers.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted">{emptyMessage}</div>
    );
  }
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Provider</th>
          <th>Advertised as</th>
          <th>Input $/M</th>
          <th>Output $/M</th>
        </tr>
      </thead>
      <tbody>
        {providers.map((p) => (
          <tr key={p.address}>
            <td>
              <Link
                href={`/sellers/${p.address}`}
                className="font-mono text-accent hover:underline text-xs"
              >
                {shortAddr(p.address)}
              </Link>
              <VerifiedLabel displayName={p.display_name} />
            </td>
            <td className="text-muted text-xs">
              {p.advertised_as.map((a, i) => (
                <span key={a}>
                  {i > 0 && ", "}
                  <span className="font-mono">{a}</span>
                </span>
              ))}
            </td>
            <td className="text-muted text-xs">
              {p.pricing?.inputUsdPerMillion != null
                ? `$${p.pricing.inputUsdPerMillion.toFixed(2)}`
                : "—"}
            </td>
            <td className="text-muted text-xs">
              {p.pricing?.outputUsdPerMillion != null
                ? `$${p.pricing.outputUsdPerMillion.toFixed(2)}`
                : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
