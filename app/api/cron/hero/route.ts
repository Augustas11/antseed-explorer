import { NextRequest, NextResponse } from "next/server";
import { authorizedBearer } from "@/lib/operatorAuth";
import { refreshHeroSnapshot } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!authorizedBearer(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get("repair") !== "1") {
    return NextResponse.json(
      {
        ok: false,
        error: "manual_repair_required",
        message:
          "Hero snapshots are scheduled from /api/cron/sync. Use ?repair=1 for an authenticated manual repair refresh.",
      },
      { status: 409 },
    );
  }

  try {
    const hero = await refreshHeroSnapshot();
    return NextResponse.json({
      ok: true,
      hero: {
        at: hero.at,
        sourceLastSyncTs: hero.source.lastSyncTs,
        sourceLastIndexedBlock: hero.source.lastIndexedBlock,
        totalRevenueUsdc: hero.stats.totalRevenueUsdc,
        totalTokens: hero.stats.totalTokens,
        totalPayingUsers: hero.stats.totalPayingUsers,
      },
    });
  } catch (e: any) {
    console.error("[cron/hero] failed", e);
    return NextResponse.json(
      { ok: false, error: "hero_snapshot_failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
