import { NextRequest, NextResponse } from "next/server";
import { listSellers, countSellers } from "@/lib/queries";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS = new Set(["volume", "sessions", "buyers", "ghosts", "first_seen"]);

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

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
  const sortParam = u.searchParams.get("sort") || "volume";
  const sort = SORTS.has(sortParam) ? (sortParam as any) : "volume";
  const dir = u.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const format = u.searchParams.get("format");

  const [rows, total] = await Promise.all([
    listSellers({ limit, offset, sort, dir }),
    countSellers(),
  ]);

  if (format === "csv") {
    const dateStr = new Date().toISOString().slice(0, 10);
    const header =
      "rank,address,usdc_earned,sessions,unique_buyers,ghost_sessions,first_seen,first_seen_ts_utc,last_seen_ts_utc";
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
        s.first_seen_ts ? new Date(s.first_seen_ts * 1000).toISOString() : "",
        s.last_seen_ts ? new Date(s.last_seen_ts * 1000).toISOString() : "",
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

  if (format === "json") {
    const dateStr = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(rows, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="antseed-sellers-${dateStr}.json"`,
      },
    });
  }

  return NextResponse.json({ sellers: rows, total, limit, offset });
}
