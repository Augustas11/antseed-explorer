import { NextRequest, NextResponse } from "next/server";
import { getProviderCatalog } from "@/lib/queries";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { trackMcpUsage } from "@/lib/mcp-usage";

export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600",
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  trackMcpUsage(req, "sellers_services");
  const rl = await checkRateLimit(getClientIp(req), req.headers.get("x-api-key"));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { address: raw = "" } = await params;
  if (!ADDRESS_RE.test(raw)) {
    return NextResponse.json(
      { error: "invalid_address", message: "address must be 0x + 40 hex chars" },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }
  const address = raw.toLowerCase();

  const row = await getProviderCatalog(address);

  if (!row) {
    return NextResponse.json(
      {
        error: "provider_not_indexed",
        message:
          "This address is not in the AntFeed provider directory. The directory is refreshed hourly from network.antseed.com.",
        address,
      },
      { status: 404, headers: RESPONSE_HEADERS },
    );
  }

  return NextResponse.json({
    address: row.address,
    displayName: row.displayName,
    region: row.region,
    services: row.services,
    pricing: row.pricing,
    updatedAt: row.updatedAt,
  }, { headers: RESPONSE_HEADERS });
}
