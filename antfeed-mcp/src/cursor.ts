// Opaque cursor encoding for paginated tools. The cursor wraps the upstream
// offset so callers cannot derive or skip past the page index by string math.
// `base64url` so the cursor is safe in JSON/URL contexts without escaping.

// Ceiling on decoded offset. Pagination today is over windows of ≤1000 rows
// (LOOKUP_PAGE_SIZE) or the explorer's reported total (low millions max), so
// 1e7 leaves plenty of headroom while preventing an attacker-supplied cursor
// from forcing 2**40 iterations in any future tool that loops offset → upstream.
const MAX_OFFSET = 10_000_000;

export function encodeCursor(nextOffset: number): string {
  const payload = JSON.stringify({ o: Math.max(0, Math.floor(nextOffset)) });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): number {
  if (cursor == null || cursor === "") return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError();
  }
  if (typeof parsed !== "object" || parsed === null) throw new InvalidCursorError();
  const raw = (parsed as { o?: unknown }).o;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_OFFSET) throw new InvalidCursorError();
  return Math.floor(n);
}

export class InvalidCursorError extends Error {
  code = "INVALID_CURSOR" as const;
  constructor() {
    super("cursor is not a valid pagination token returned by a previous call");
    this.name = "InvalidCursorError";
  }
}
