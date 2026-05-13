import { NextRequest, NextResponse } from "next/server";
import { listBuyers, countBuyers } from "@/lib/queries";

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
  const qualifiedOnly = u.searchParams.get("qualified") === "1";
  const minScore = Number(u.searchParams.get("minScore") || 0);
  const sort = (u.searchParams.get("sort") || "volume") as any;
  const format = u.searchParams.get("format");

  const [rows, total] = await Promise.all([
    listBuyers({ limit, offset, qualifiedOnly, minScore, sort }),
    countBuyers({ qualifiedOnly, minScore }),
  ]);

  if (format === "csv") {
    const dateStr = new Date().toISOString().slice(0, 10);
    const header =
      "rank,address,usdc,sessions,unique_sellers,ghost_sessions,first_seen,trust_score,first_seen_block,last_seen_block,first_seen_ts_utc,last_seen_ts_utc";
    const lines = rows.map((b, i) =>
      csvLine([
        offset + i + 1,
        b.address,
        b.total_settled_usdc,
        b.total_sessions,
        b.unique_sellers,
        b.ghost_sessions,
        b.first_seen_ts
          ? new Date(b.first_seen_ts * 1000).toISOString().slice(0, 10)
          : "",
        b.trust_score,
        b.first_seen_block ?? "",
        b.last_seen_block ?? "",
        b.first_seen_ts ? new Date(b.first_seen_ts * 1000).toISOString() : "",
        b.last_seen_ts ? new Date(b.last_seen_ts * 1000).toISOString() : "",
      ]),
    );
    const csv = [header, ...lines].join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="antseed-buyers-${dateStr}.csv"`,
      },
    });
  }

  return NextResponse.json({ buyers: rows, total, limit, offset });
}
