import { NextRequest, NextResponse } from "next/server";
import { getChannel } from "@/lib/queries";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { trackMcpUsage } from "@/lib/mcp-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNEL_ID_RE = /^0x[0-9a-fA-F]{64}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  trackMcpUsage(req, "channels_detail");
  const rl = await checkRateLimit(getClientIp(req), req.headers.get("x-api-key"));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { id } = await params;
  if (!CHANNEL_ID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_channel_id" }, { status: 400 });
  }

  const channel = await getChannel(id.toLowerCase());
  if (!channel) {
    return NextResponse.json({ error: "channel_not_found" }, { status: 404 });
  }
  return NextResponse.json(channel);
}
