import { NextRequest, NextResponse } from "next/server";
import { listChannels, countChannels } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvLine(fields: (string | number | null | undefined)[]): string {
  return fields
    .map((f) => {
      if (f == null) return "";
      const s = String(f);
      if (/[,"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    })
    .join(",");
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const limit = Math.min(1000, Number(u.searchParams.get("limit") || 100));
  const offset = Number(u.searchParams.get("offset") || 0);
  const sort = (u.searchParams.get("sort") || "opened") as
    | "amount"
    | "settled"
    | "events"
    | "opened"
    | "last_activity";
  const dir = (u.searchParams.get("dir") || "desc") as "asc" | "desc";
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

  return NextResponse.json({ channels: rows, total, limit, offset });
}
