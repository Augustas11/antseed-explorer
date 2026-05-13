"use client";

interface Props {
  /** Milliseconds epoch — when the provider was last refreshed. */
  updatedAt: number | null;
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function fmtAge(diffMs: number): string {
  if (diffMs < 1_000) return "just now";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1_000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

export default function StatusDot({ updatedAt }: Props) {
  let color: string;
  let title: string;

  if (updatedAt == null) {
    color = "bg-[var(--color-bad)]";
    title = "No update timestamp";
  } else {
    const diff = Math.max(0, Date.now() - updatedAt);
    if (diff < TWO_HOURS_MS) {
      color = "bg-[var(--color-accent)]";
      title = `Fresh — ${fmtAge(diff)}`;
    } else if (diff < ONE_DAY_MS) {
      color = "bg-[var(--color-warn)]";
      title = `Stale — ${fmtAge(diff)}`;
    } else {
      color = "bg-[var(--color-bad)]";
      title = `Outdated — ${fmtAge(diff)}`;
    }
  }

  return (
    <span
      className={`w-2 h-2 rounded-full inline-block ${color}`}
      title={title}
      aria-label={title}
    />
  );
}
