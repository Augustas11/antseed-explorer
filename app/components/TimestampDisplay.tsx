"use client";

import { useTsFmt } from "./Providers";

interface Props {
  ts: number | null | undefined;
  /** Show full datetime (default) or date-only */
  dateOnly?: boolean;
}

export default function TimestampDisplay({ ts, dateOnly = false }: Props) {
  const { fmt } = useTsFmt();

  if (!ts) return <span className="text-muted">—</span>;

  if (fmt === "unix") {
    return <span className="font-mono text-xs">{ts}</span>;
  }

  const d = new Date(ts * 1000);

  if (fmt === "local") {
    return (
      <span title={d.toISOString()}>
        {dateOnly ? d.toLocaleDateString() : d.toLocaleString()}
      </span>
    );
  }

  // UTC (default)
  const iso = d.toISOString();
  return (
    <span title={iso}>
      {dateOnly ? iso.slice(0, 10) : iso.replace("T", " ").slice(0, 19) + " UTC"}
    </span>
  );
}
