import { NextRequest, NextResponse } from "next/server";
import { sync, refreshProviderDirectory } from "@/lib/indexer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel will route /api/cron/sync to this handler. We allow up to 60s
// (Vercel Pro). On Hobby this caps at 10s but the indexer is resumable so
// next tick picks up where we left off.
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    if (process.env.NODE_ENV === "production") return false;
    return true;
  }
  // Accept secret via Authorization header (Vercel Cron / GitHub Actions)
  // OR as ?secret= query param (cron-job.org and other services that can't
  // reliably set custom headers).
  const header = req.headers.get("authorization");
  if (header === `Bearer ${expected}`) return true;
  const param = req.nextUrl.searchParams.get("secret");
  return param === expected;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    // Force=true so cron runs every tick regardless of debounce.
    // 50s deadline leaves 10s headroom under Vercel Pro's 60s cap.
    const result = await sync({ force: true, deadlineMs: 50_000 });
    await refreshProviderDirectory();
    return NextResponse.json(result);
  } catch (e: any) {
    // DrizzleQueryError stores the real Postgres/Neon error in e.cause
    const cause = e?.cause;
    const causeMsg = cause?.message || "";
    const extras: Record<string, unknown> = {};
    for (const k of ["code", "detail", "hint", "constraint", "table", "column"]) {
      const v = cause?.[k] ?? e?.[k];
      if (v) extras[k] = v;
    }
    return NextResponse.json(
      { ok: false, error: causeMsg || e?.message || String(e), drizzle: causeMsg ? e?.message?.slice(0, 120) : undefined, ...extras },
      { status: 500 },
    );
  }
}

// Some cron services prefer POST.
export async function POST(req: NextRequest) {
  return GET(req);
}
