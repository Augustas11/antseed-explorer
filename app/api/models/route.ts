import { NextRequest, NextResponse } from "next/server";
import { getModelUsage, type ModelUsageSort } from "@/lib/queries";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { trackMcpUsage } from "@/lib/mcp-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS = new Set<ModelUsageSort>(["spend", "sellers", "tokens", "requests"]);

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export async function GET(req: NextRequest) {
  trackMcpUsage(req, "models");
  const rl = await checkRateLimit(getClientIp(req), req.headers.get("x-api-key"));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const u = new URL(req.url);
  const limit = intParam(u.searchParams.get("limit"), 100, 1, 500);
  const sortRaw = u.searchParams.get("sort") ?? "spend";
  const sort: ModelUsageSort = SORTS.has(sortRaw as ModelUsageSort)
    ? (sortRaw as ModelUsageSort)
    : "spend";

  const usage = await getModelUsage({ sort, limit });
  return NextResponse.json(usage);
}
