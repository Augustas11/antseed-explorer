import { NextRequest, NextResponse } from "next/server";
import { sync, refreshProviderDirectory } from "@/lib/indexer";
import { refreshDiemPoolSnapshot } from "@/lib/diem";
import { refreshHeroSnapshot } from "@/lib/queries";
import { authorizedBearer } from "@/lib/operatorAuth";
import {
  recomputeServiceMetadata,
  decodePendingMetadata,
} from "@/lib/serviceMetadata";

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
    // Per-model v2 attribution runs BEFORE refreshProviderDirectory: the
    // rebuild reads from snapshots + events and never depends on
    // service_id_aliases (aliases join in the query layer, not in the CST/DSM
    // SQL). Putting it first guarantees rollup freshness even when an
    // upstream network.antseed.com fetch slows the rest of the tick.
    // Drain at least a tiny chunk every tick so the prefix-pending gate keeps
    // advancing under sustained budget pressure — otherwise a single pending
    // event holds back every later snapshot on that channel.
    try {
      const pendingBudget = remaining(5_000);
      if (pendingBudget >= 3_000) {
        await decodePendingMetadata(500);
      } else if (pendingBudget >= 500) {
        await decodePendingMetadata(50);
      }
      await recomputeServiceMetadata();
    } catch (e) {
      console.warn("[cron/sync] service metadata rebuild failed", e);
    }
    await refreshProviderDirectory();
    // DIEM + hero snapshots are SSR-warm-up jobs — they don't need to refresh
    // every 15 min. Gate them to the top of each hour so the cron tick that
    // actually does this work runs ~24×/day instead of 96×/day.
    const heavyTick = new Date().getUTCMinutes() < 15;
    const diemBudget = heavyTick ? remaining(1_000) : 0;
    const diem =
      diemBudget >= 2_000
        ? await refreshDiemPoolSnapshot({ deadlineMs: diemBudget })
        : null;
    const heroBudget = heavyTick ? remaining(1_000) : 0;
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
      hero: hero
        ? {
            at: hero.at,
            sourceLastSyncTs: hero.source.lastSyncTs,
            sourceLastIndexedBlock: hero.source.lastIndexedBlock,
          }
        : null,
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
