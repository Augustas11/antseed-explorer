import Link from "next/link";

const RANGES = [
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "all", value: "all" },
] as const;

interface TimeRangePillsProps {
  current: string;
  basePath: string;
  extraParams?: Record<string, string>;
}

export default function TimeRangePills({
  current,
  basePath,
  extraParams = {},
}: TimeRangePillsProps) {
  return (
    <div className="flex items-center gap-1">
      {RANGES.map(({ label, value }) => {
        const isActive = current === value;
        const params = new URLSearchParams({ ...extraParams, range: value });
        return (
          <Link
            key={value}
            href={`${basePath}?${params.toString()}`}
            className={`pill text-xs ${
              isActive
                ? "bg-accent/20 text-accent border-accent/40"
                : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
