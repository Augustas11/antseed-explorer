import { NextRequest, NextResponse } from "next/server";
import { listChannels, countChannels } from "@/lib/queries";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { trackMcpUsage } from "@/lib/mcp-usage";
import { csvLine } from "@/lib/csv";
import { CHANNEL_DEFAULT_SORT, CHANNEL_SORTS, type ChannelSort } from "@/lib/publicApiContract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS = new Set<string>(CHANNEL_SORTS);

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  if (value == null || value === "") return fallback;
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export async function GET(req: NextRequest) {
  trackMcpUsage(req, "channels");
  const rl = await checkRateLimit(getClientIp(req), req.headers.get("x-api-key"));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const u = new URL(req.url);
  const limit = intParam(u.searchParams.get("limit"), 100, 1, 1000);
  const offset = intParam(u.searchParams.get("offset"), 0, 0, 100_000);
  const sortParam = u.searchParams.get("sort") || CHANNEL_DEFAULT_SORT;
  const sort: ChannelSort = SORTS.has(sortParam) ? (sortParam as ChannelSort) : CHANNEL_DEFAULT_SORT;
  const dir = u.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const format = u.searchParams.get("format");

  const [rows, total] = await Promise.all([
    listChannels({ limit, offset, sort, dir }),
    countChannels(),
  ]);

  if (format === "csv") {
    const dateStr = new Date().toISOString().slice(0, 10);
    const header =
      "channel_id,state,buyer_address,seller_address,opened_block,last_block,max_amount_usdc,settled_amount_usdc,event_count,opened_ts_utc,last_activity_ts_utc";
    const lines = rows.map((c) =>
      csvLine([
        c.channel_id,
        c.state,
        c.buyer_address,
        c.seller_address,
        c.opened_block,
        c.last_block,
        c.max_amount_usdc,
        c.settled_amount_usdc,
        c.event_count,
        c.opened_ts ? new Date(c.opened_ts * 1000).toISOString() : "",
        c.last_ts ? new Date(c.last_ts * 1000).toISOString() : "",
      ]),
    );
    const csv = [header, ...lines].join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="antseed-channels-${dateStr}.csv"`,
      },
    });
  }

  if (format === "json") {
    const dateStr = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(rows, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="antseed-channels-${dateStr}.json"`,
      },
    });
  }

  return NextResponse.json({ channels: rows, total, limit, offset });
}
