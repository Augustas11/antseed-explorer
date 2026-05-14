import type { ReactNode } from "react";
import { fmtPct } from "@/lib/format";

interface HeroCardProps {
  label: string;
  value: string;
  sublabel?: ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  tooltip?: string;
  sparkline?: ReactNode;
}

export default function HeroCard({
  label,
  value,
  sublabel,
  delta,
  deltaLabel = "vs prior 30d",
  tooltip,
  sparkline,
}: HeroCardProps) {
  const deltaCls =
    delta == null
      ? "text-muted"
      : delta > 0
      ? "text-accent"
      : delta < 0
      ? "text-bad"
      : "text-muted";

  return (
    <div className="panel p-5 flex flex-col gap-2" title={tooltip}>
      <div className="text-xs uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className="text-4xl font-semibold text-ink tabular-nums leading-tight">
        {value}
      </div>
      {sparkline ? <div className="mt-1">{sparkline}</div> : null}
      <div className="flex items-baseline justify-between gap-2 mt-auto text-xs">
        <span className="text-muted truncate">{sublabel ?? ""}</span>
        <span className={`tabular-nums ${deltaCls}`}>
          {fmtPct(delta ?? null)}
          <span className="text-muted ml-1">{deltaLabel}</span>
        </span>
      </div>
    </div>
  );
}
