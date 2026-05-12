import { NextRequest, NextResponse } from "next/server";
import { listSellers, countSellers } from "@/lib/queries";

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
  const sort = (u.searchParams.get("sort") || "volume") as any;
  const dir = (u.searchParams.get("dir") || "desc") as "asc" | "desc";
  const format = u.searchParams.get("format");

  const [rows, total] = await Promise.all([
    listSellers({ limit, offset, sort, dir }),
    countSellers(),
  ]);

  if (format === "csv") {
    const dateStr = new Date().toISOString().slice(0, 10);
    const header =
      "rank,address,usdc_earned,sessions,unique_buyers,ghost_sessions,first_seen";
    const lines = rows.map((s, i) =>
      csvLine([
        offset + i + 1,
        s.address,
        s.total_earned_usdc,
        s.total_sessions,
        s.unique_buyers,
        s.ghost_sessions,
        s.first_seen_ts
          ? new Date(s.first_seen_ts * 1000).toISOString().slice(0, 10)
          : "",
      ]),
    );
    const csv = [header, ...lines].join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="antseed-sellers-${dateStr}.csv"`,
      },
    });
  }

  return NextResponse.json({ sellers: rows, total, limit, offset });
}
