// Daily Active Users metric — read-only, served from the `daily_dau`
// pre-aggregate populated by lib/indexer.ts:recomputeDailyDau. Matches
// Dune query 6974179 row-for-row:
//   total    = dau              (count distinct addr across deposits+channels)
//   new      = new_users        (buyer's first lifetime Deposited on this day)
//   existing = total - new      (Dune's stacked chart derives this on the FE)
// One row per UTC day. The "today" bucket updates each cron pulse; closed
// days are immutable once written.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
};

function isValidDate(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function defaultFrom(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 29);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const fromRaw = u.searchParams.get("from");
  const toRaw = u.searchParams.get("to");
  const granularity = (u.searchParams.get("granularity") || "day").toLowerCase();

  if (granularity !== "day") {
    return NextResponse.json(
      { error: "unsupported_granularity", supported: ["day"] },
      { status: 400 },
    );
  }

  const from = isValidDate(fromRaw) ? fromRaw : defaultFrom();
  const to = isValidDate(toRaw) ? toRaw : defaultTo();
  if (from > to) {
    return NextResponse.json(
      { error: "invalid_range", from, to },
      { status: 400 },
    );
  }

  // sql.raw is safe — from/to are validated above against /^\d{4}-\d{2}-\d{2}$/.
  const r = await db.execute<{
    day: string;
    dau: number;
    dau_buyers: number;
    dau_sellers: number;
    new_users: number;
  }>(sql`
    SELECT
      to_char(day, 'YYYY-MM-DD') AS day,
      dau::int                   AS dau,
      dau_buyers::int            AS dau_buyers,
      dau_sellers::int           AS dau_sellers,
      new_users::int             AS new_users
    FROM daily_dau
    WHERE day >= DATE '${sql.raw(from)}'
      AND day <= DATE '${sql.raw(to)}'
    ORDER BY day ASC
  `);

  const rows = r.rows.map((row) => ({
    day: row.day,
    new: Number(row.new_users) || 0,
    existing: (Number(row.dau) || 0) - (Number(row.new_users) || 0),
    total: Number(row.dau) || 0,
    dau_buyers: Number(row.dau_buyers) || 0,
    dau_sellers: Number(row.dau_sellers) || 0,
  }));

  return NextResponse.json(rows, { headers: RESPONSE_HEADERS });
}
