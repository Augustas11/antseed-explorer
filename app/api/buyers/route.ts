import { NextRequest, NextResponse } from "next/server";
import { listBuyers, countBuyers } from "@/lib/queries";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS = new Set(["score", "volume", "sessions", "first_seen", "unique_sellers", "ghosts"]);

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function scoreParam(value: string | null): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
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
  const qualifiedOnly = u.searchParams.get("qualified") === "1";
  const minScore = scoreParam(u.searchParams.get("minScore"));
  const sortParam = u.searchParams.get("sort") || "volume";
  const sort = SORTS.has(sortParam) ? (sortParam as any) : "volume";
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

  if (format === "json") {
    const dateStr = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(rows, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="antseed-buyers-${dateStr}.json"`,
      },
    });
  }

  return NextResponse.json({ buyers: rows, total, limit, offset });
}
