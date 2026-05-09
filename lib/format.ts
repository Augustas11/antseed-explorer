export function shortAddr(a: string | null | undefined, head = 6, tail = 4) {
  if (!a) return "—";
  if (a.length <= head + tail) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function fmtUsd(n: number) {
  if (n == null) return "$0";
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n > 0) return `$${n.toFixed(4)}`;
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
