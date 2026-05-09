import { NextRequest, NextResponse } from "next/server";
import { getBuyer } from "@/lib/queries";
import { calculateTrustScore } from "@/lib/score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  _req: NextRequest,
  { params }: { params: { address: string } },
) {
  const profile = await getBuyer(params.address);
  if (!profile) {
    return NextResponse.json(
      {
        address: params.address.toLowerCase(),
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
    address: profile.address,
    totalSessions: profile.total_sessions,
    totalSettledUsdc: profile.total_settled_usdc,
    uniqueSellers: profile.unique_sellers,
    ghostSessions: profile.ghost_sessions,
  });
  const tier = breakdown.total >= 70 ? "trusted" : breakdown.total >= 40 ? "developing" : "new";
  return NextResponse.json(
    {
      address: profile.address,
      score: breakdown.total,
      tier,
      qualified: breakdown.qualified,
      breakdown,
      stats: {
        totalSessions: profile.total_sessions,
        totalSettledUsdc: profile.total_settled_usdc,
        uniqueSellers: profile.unique_sellers,
        ghostSessions: profile.ghost_sessions,
        firstSeenBlock: profile.first_seen_block,
        lastSeenBlock: profile.last_seen_block,
      },
    },
    { headers: RESPONSE_HEADERS },
  );
}
