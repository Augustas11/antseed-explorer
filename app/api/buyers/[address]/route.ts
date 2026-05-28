import { NextRequest, NextResponse } from "next/server";
import {
  getBuyer,
  getBuyerSessions,
  getBuyerSellerSummary,
  getBuyerMonthlyVolume,
  lookupProviders,
  isExplorerAddress,
} from "@/lib/queries";
import { trackMcpUsage } from "@/lib/mcp-usage";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { address: string } },
) {
  trackMcpUsage(req, "buyers_detail");
  const rl = await checkRateLimit(getClientIp(req), req.headers.get("x-api-key"));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  if (!isExplorerAddress(params.address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  const profile = await getBuyer(params.address);
  if (!profile) {
    return NextResponse.json({ error: "buyer_not_found" }, { status: 404 });
  }
  const [sessions, topSellers, monthly] = await Promise.all([
    getBuyerSessions(params.address, 50),
    getBuyerSellerSummary(params.address, 10),
    getBuyerMonthlyVolume(params.address),
  ]);
  const providerMap = await lookupProviders([
    ...sessions.map((s) => s.seller_address),
    ...topSellers.map((s) => s.seller_address),
  ]);
  const sessionsAnnotated = sessions.map((s) => ({
    ...s,
    seller_label: providerMap.get(s.seller_address || "")?.display_name || null,
  }));
  const topSellersAnnotated = topSellers.map((s) => ({
    ...s,
    seller_label: providerMap.get(s.seller_address)?.display_name || null,
  }));
  return NextResponse.json({
    profile,
    sessions: sessionsAnnotated,
    topSellers: topSellersAnnotated,
    monthly,
  });
}
