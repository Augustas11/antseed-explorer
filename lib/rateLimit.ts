// Sliding-window rate limiter using in-process Maps.
// Works for single-instance deployments (dev, Vercel Fluid Compute reuse).
// Limits are soft on multi-instance — still bounds any one instance.

const FREE_LIMIT = 60;    // req/min, no key
const KEY_LIMIT = 300;    // req/min, valid API key
const WINDOW_MS = 60_000;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

function check(id: string, limit: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(id);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(id, { count: 1, windowStart: now });
    return { allowed: true, retryAfter: 0 };
  }

  if (bucket.count >= limit) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - bucket.windowStart)) / 1000);
    return { allowed: false, retryAfter };
  }

  bucket.count += 1;
  return { allowed: true, retryAfter: 0 };
}

// Prune stale buckets to prevent unbounded growth (runs at most once/minute).
let lastPrune = 0;
function maybePrune() {
  const now = Date.now();
  if (now - lastPrune < WINDOW_MS) return;
  lastPrune = now;
  for (const [id, bucket] of buckets) {
    if (now - bucket.windowStart >= WINDOW_MS * 2) buckets.delete(id);
  }
}

export function checkRateLimit(
  ip: string,
  apiKey: string | null,
): { allowed: boolean; retryAfter: number } {
  maybePrune();
  if (apiKey) {
    return check(`key:${apiKey}`, KEY_LIMIT);
  }
  return check(`ip:${ip}`, FREE_LIMIT);
}

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}
