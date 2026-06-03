import { NextRequest, NextResponse } from "next/server";
import { sync, refreshProviderDirectory } from "@/lib/indexer";
import { refreshDiemPoolSnapshot } from "@/lib/diem";
import { refreshHeroSnapshot } from "@/lib/queries";
import { authorizedBearer } from "@/lib/operatorAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel will route /api/cron/sync to this handler. We allow up to 60s
// (Vercel Pro). On Hobby this caps at 10s but the indexer is resumable so
// next tick picks up where we left off.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!authorizedBearer(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const startedAt = Date.now();
    const remaining = (reserveMs: number) =>
      Math.max(0, 58_000 - reserveMs - (Date.now() - startedAt));

    // Force=true so cron runs every tick regardless of debounce.
    // Leave explicit headroom for provider + DIEM refresh under the 60s cap.
    const result = await sync({ force: true, deadlineMs: 45_000 });
    await refreshProviderDirectory();
    // Persist the DIEM pool snapshot so the SSR home page never has to do a
    // Base RPC enumeration. Errors are swallowed inside the refresher.
    const diemBudget = remaining(1_000);
    const diem =
      diemBudget >= 2_000
        ? await refreshDiemPoolSnapshot({ deadlineMs: diemBudget })
        : null;
    const heroBudget = remaining(1_000);
    const hero =
      heroBudget >= 3_000
        ? await refreshHeroSnapshot().catch((e) => {
            console.warn("[cron/sync] hero snapshot refresh failed", e);
            return null;
          })
        : null;
    return NextResponse.json({
      ...result,
      diem: diem ? { count: diem.count, exactAddresses: diem.exactAddresses } : null,
      hero: hero ? { at: hero.at } : null,
    });
  } catch (e: any) {
    console.error("[cron/sync] failed", e);
    return NextResponse.json(
      { ok: false, error: "sync_failed" },
      { status: 500 },
    );
  }
}

// Some cron services prefer POST.
export async function POST(req: NextRequest) {
  return GET(req);
}
