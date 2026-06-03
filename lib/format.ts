export function shortAddr(a: string | null | undefined, head = 6, tail = 4) {
  if (!a) return "—";
  if (a.length <= head + tail) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function fmtUsd(n: number) {
  if (n == null) return "$0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs > 0) return `${sign}$${abs.toFixed(4)}`;
  return "$0";
}

export function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString();
}

export function fmtRelative(ts: number | null) {
  if (!ts) return "never";
  const sec = Math.floor((Date.now() / 1000) - ts);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function fmtDate(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

// Compact units for headline numbers (token counts, large totals). Picks
// thousands/millions/billions/trillions; one decimal except when the integer
// part already has ≥3 digits to keep the card width stable.
export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a < 1_000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [div, suffix] of units) {
    if (a >= div) {
      const v = n / div;
      return `${v.toFixed(v >= 100 ? 0 : 1)}${suffix}`;
    }
  }
  return n.toString();
}

// Percent delta between two windows. Returns `null` when prior is zero — the
// UI renders that as a muted dash, never a misleading "+∞%" or "0%".
export function pctDelta(recent: number, prior: number): number | null {
  if (!Number.isFinite(recent) || !Number.isFinite(prior)) return null;
  if (prior === 0) return null;
  return ((recent - prior) / prior) * 100;
}

export function fmtPct(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const sign = p > 0 ? "+" : "";
  const digits = Math.abs(p) >= 100 ? 0 : 1;
  return `${sign}${p.toFixed(digits)}%`;
}
