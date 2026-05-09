import { NextRequest, NextResponse } from "next/server";
import { sync, refreshProviderDirectory } from "@/lib/indexer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel will route /api/cron/sync to this handler. We allow up to 60s
// (Vercel Pro). On Hobby this caps at 10s but the indexer is resumable so
// next tick picks up where we left off.
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  // Vercel Cron sets `Authorization: Bearer <CRON_SECRET>` automatically when
  // CRON_SECRET is set in env. External pingers (cron-job.org) can use the
  // same header.
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // dev-mode: allow if not configured
  const got = req.headers.get("authorization");
  return got === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // Force=true so cron runs every tick regardless of debounce.
  // 50s deadline leaves 10s headroom under Vercel Pro's 60s cap.
  const result = await sync({ force: true, deadlineMs: 50_000 });
  await refreshProviderDirectory();
  return NextResponse.json(result);
}

// Some cron services prefer POST.
export async function POST(req: NextRequest) {
  return GET(req);
}
