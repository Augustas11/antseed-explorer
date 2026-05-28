import { NextRequest, NextResponse } from "next/server";
import { listProviders } from "@/lib/queries";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { trackMcpUsage } from "@/lib/mcp-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SORTS = ["volume", "sessions", "ghost"] as const;
type Sort = (typeof ALLOWED_SORTS)[number];

function intParam(value: string | null, fallback: number, min: number, max: number): number {
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
  const sortParam = u.searchParams.get("sort") || "volume";
  const sort: Sort = (ALLOWED_SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as Sort)
    : "volume";

  const all = await listProviders({ sort });
  const page = all.slice(offset, offset + limit);

  return NextResponse.json({
    providers: page,
    total: all.length,
    limit,
    offset,
  });
}
