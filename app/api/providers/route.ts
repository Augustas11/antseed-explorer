import { NextRequest, NextResponse } from "next/server";
import { countProviders, listProviders, type ProviderSortKey } from "@/lib/queries";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { trackMcpUsage } from "@/lib/mcp-usage";
import { PROVIDER_DEFAULT_SORT, PROVIDER_SORTS } from "@/lib/publicApiContract";

export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600",
};

const ALLOWED_SORTS = new Set<string>(PROVIDER_SORTS);

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  if (value == null || value === "") return fallback;
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export async function GET(req: NextRequest) {
  trackMcpUsage(req, "providers");
  const rl = await checkRateLimit(getClientIp(req), req.headers.get("x-api-key"));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const u = new URL(req.url);
  const limit = intParam(u.searchParams.get("limit"), 100, 1, 1000);
  const offset = intParam(u.searchParams.get("offset"), 0, 0, 100_000);
  const sortParam = u.searchParams.get("sort") || PROVIDER_DEFAULT_SORT;
  const sort: ProviderSortKey = ALLOWED_SORTS.has(sortParam)
    ? (sortParam as ProviderSortKey)
    : PROVIDER_DEFAULT_SORT;

  const [providers, total] = await Promise.all([
    listProviders({ sort, limit, offset }),
    countProviders(),
  ]);

  return NextResponse.json({
    providers,
    total,
    limit,
    offset,
  }, { headers: RESPONSE_HEADERS });
}
