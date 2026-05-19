import { NextRequest, NextResponse } from "next/server";
import { publicClient } from "@/lib/chain";
import { trackMcpUsage } from "@/lib/mcp-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  trackMcpUsage(req, "gas");
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
