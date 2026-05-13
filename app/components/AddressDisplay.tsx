import { getEnsName } from "@/lib/ens";
import { getLabel, KIND_COLORS } from "@/lib/labels";
import { shortAddr } from "@/lib/format";
import CopyButton from "./CopyButton";
import QRModal from "./QRModal";

interface Props {
  address: string | null | undefined;
  /** Show full address instead of shortened (default: shortened) */
  full?: boolean;
  /** Skip ENS resolution (for high-frequency list rows) */
  noEns?: boolean;
  className?: string;
}

export default async function AddressDisplay({
  address,
  full = false,
  noEns = false,
  className = "",
}: Props) {
  if (!address) return <span className="text-muted">—</span>;

  const [ens, label] = await Promise.all([
    noEns ? Promise.resolve(null) : getEnsName(address),
    Promise.resolve(getLabel(address)),
  ]);

  const display = full ? address : shortAddr(address);

  return (
    <span className={`inline-flex items-center gap-1.5 flex-wrap ${className}`}>
      {ens && (
        <span className="font-medium text-ink">{ens}</span>
      )}
      <code className="font-mono text-xs text-muted">{display}</code>
      <CopyButton text={address} />
      <QRModal address={address} />
      {label && (
        <span className={`badge ${KIND_COLORS[label.kind]} !text-[10px] !px-1.5 !py-0`}>
          {label.name}
        </span>
      )}
    </span>
  );
}
