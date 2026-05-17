import { NextRequest, NextResponse } from "next/server";
import { getNetworkStats, getDailyVolume, getProfileDrift } from "@/lib/queries";
import { trackMcpUsage } from "@/lib/mcp-usage";

export const runtime = "nodejs";
// Aggregates change at most every minute (when the indexer pulses).
// 30s edge cache + SWR keeps Neon out of the request path for 95% of hits.
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
};

export async function GET(req: NextRequest) {
  trackMcpUsage(req, "stats");
  // Serialized — Promise.all of many Neon HTTP requests from a cold Vercel
  // serverless instance occasionally returned empty rows. Sequential calls
  // are still <500ms total and 100% reliable.
  const stats = await getNetworkStats();
  const daily = await getDailyVolume(30);
  const drift = await getProfileDrift();
  return NextResponse.json(
    { ...stats, daily, drift },
    { headers: RESPONSE_HEADERS },
  );
}
