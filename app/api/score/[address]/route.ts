import { NextRequest, NextResponse } from "next/server";
import { getBuyer, isExplorerAddress } from "@/lib/queries";
import { calculateTrustScore } from "@/lib/score";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { trackMcpUsage } from "@/lib/mcp-usage";

export const runtime = "nodejs";

// Public scoring API — meant to be consumed by other dApps from the browser.
// 60s edge cache + SWR keeps Neon load flat; CORS lets browser callers in.
const RESPONSE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: RESPONSE_HEADERS });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  trackMcpUsage(req, "score");
  const rl = await checkRateLimit(getClientIp(req), req.headers.get("x-api-key"));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  if (!isExplorerAddress(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const buyer = await getBuyer(address);
  if (!buyer) {
    return NextResponse.json(
      {
        address: address.toLowerCase(),
        score: 0,
        tier: "unknown",
        qualified: false,
        breakdown: null,
        reason: "no_indexed_activity",
      },
      { status: 404, headers: RESPONSE_HEADERS },
    );
  }
  const breakdown = calculateTrustScore({
    address: buyer.address,
    totalSessions: buyer.total_sessions,
    totalSettledUsdc: buyer.total_settled_usdc,
    uniqueSellers: buyer.unique_sellers,
    ghostSessions: buyer.ghost_sessions,
  });
  const tier = breakdown.total >= 70 ? "trusted" : breakdown.total >= 40 ? "developing" : "new";
  return NextResponse.json(
    {
      address: buyer.address,
      score: breakdown.total,
      tier,
      qualified: breakdown.qualified,
      breakdown,
      stats: {
        totalSessions: buyer.total_sessions,
        totalSettledUsdc: buyer.total_settled_usdc,
        uniqueSellers: buyer.unique_sellers,
        ghostSessions: buyer.ghost_sessions,
        firstSeenBlock: buyer.first_seen_block,
        lastSeenBlock: buyer.last_seen_block,
      },
    },
    { headers: RESPONSE_HEADERS },
  );
}
