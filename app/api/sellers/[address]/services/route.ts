import { NextRequest, NextResponse } from "next/server";
import { listProviders } from "@/lib/queries";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { trackMcpUsage } from "@/lib/mcp-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> | { address: string } },
) {
  trackMcpUsage(req, "sellers_services");
  const rl = await checkRateLimit(getClientIp(req), req.headers.get("x-api-key"));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const resolved = await params;
  const raw = resolved.address ?? "";
  if (!ADDRESS_RE.test(raw)) {
    return NextResponse.json(
      { error: "invalid_address", message: "address must be 0x + 40 hex chars" },
      { status: 400 },
    );
  }
  const address = raw.toLowerCase();

  // listProviders() is the canonical source — finds the directory row + on-chain
  // aggregates. The provider list is small (≤ a few hundred), so a full scan is
  // acceptable; if it grows we can add a getProvider(address) helper.
  const all = await listProviders({ sort: "volume" });
  const row = all.find((p) => p.address.toLowerCase() === address);

  if (!row) {
    return NextResponse.json(
      {
        error: "provider_not_indexed",
        message:
          "This address is not in the AntFeed provider directory. The directory is refreshed hourly from network.antseed.com.",
        address,
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    address: row.address,
    displayName: row.displayName,
    region: row.region,
    services: row.services,
    pricing: row.pricing,
    updatedAt: row.updatedAt,
  });
}
