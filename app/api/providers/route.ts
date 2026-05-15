import { NextRequest, NextResponse } from "next/server";
import { listProviders } from "@/lib/queries";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SORTS = ["volume", "sessions", "ghost"] as const;
type Sort = (typeof ALLOWED_SORTS)[number];

export async function GET(req: NextRequest) {
  const rl = await checkRateLimit(getClientIp(req), req.headers.get("x-api-key"));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const u = new URL(req.url);
  const limit = Math.min(1000, Math.max(1, Number(u.searchParams.get("limit") || 100)));
  const offset = Math.max(0, Number(u.searchParams.get("offset") || 0));
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
