import Link from "next/link";

interface SortableHeaderProps {
  field: string;
  current: string;
  dir: "asc" | "desc";
  basePath: string;
  extraParams?: Record<string, string>;
  defaultDir?: "asc" | "desc";
  children: React.ReactNode;
}

export default function SortableHeader({
  field,
  current,
  dir,
  basePath,
  extraParams = {},
  defaultDir = "desc",
  children,
}: SortableHeaderProps) {
  const isActive = current === field;
  // If active: toggle dir. If not active: use defaultDir.
  const nextDir = isActive ? (dir === "asc" ? "desc" : "asc") : defaultDir;
  const glyph = isActive ? (dir === "asc" ? "▲" : "▼") : "⇅";
  const glyphClass = isActive ? "text-accent" : "text-muted/40";

  const params = new URLSearchParams({ ...extraParams, sort: field, dir: nextDir });
  const href = `${basePath}?${params.toString()}`;

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 hover:text-accent transition-colors whitespace-nowrap"
    >
      {children}
      <span className={`text-[10px] ${glyphClass}`}>{glyph}</span>
    </Link>
  );
}
