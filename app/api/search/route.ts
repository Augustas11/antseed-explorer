import { NextRequest, NextResponse } from "next/server";
import { trackMcpUsage } from "@/lib/mcp-usage";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { resolveSearchMatches } from "@/lib/searchResolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  trackMcpUsage(req, "search");
  const rl = await checkRateLimit(getClientIp(req), req.headers.get("x-api-key"));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const matches = await resolveSearchMatches(q, 8);
  return NextResponse.json({ matches });
}
