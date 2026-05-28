import { NextRequest, NextResponse } from "next/server";
import { publicClient } from "@/lib/chain";
import { trackMcpUsage } from "@/lib/mcp-usage";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  trackMcpUsage(req, "gas");
  const rl = await checkRateLimit(getClientIp(req), req.headers.get("x-api-key"));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  try {
    const fees = await publicClient.estimateFeesPerGas();
    const wei = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
    const gwei = Number(wei) / 1e9;
    return NextResponse.json({ gwei: gwei.toFixed(4) }, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch {
    return NextResponse.json({ gwei: null }, { status: 200 });
  }
}
