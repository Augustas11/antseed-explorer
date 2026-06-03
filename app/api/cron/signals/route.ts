// Cron route: run the signal detector and return what it found as JSON.
//
// Auth mirrors /api/cron/sync: Authorization: Bearer ${CRON_SECRET}.
//
// What this route writes: nothing.
// On the explorer's Vercel deployment there is no sibling `antfeed` repo
// on disk, the filesystem is ephemeral between invocations, and the
// signal-state file would not persist anyway. Writing cards somewhere
// only this one invocation can see would be misleading. So this route
// runs the detectors in dry-run mode and surfaces only status metadata in the
// JSON response. Full cards are kept in the local operator pipeline.
// The authoritative pipeline that persists state and writes cards into
// `marketing/signals/` is the operator running `npm run signals` locally
// from the explorer repo.
//
// Coverage caveat (current — not blocking ship):
// Supply-side detectors (daily_new_service_offered,
// daily_service_supply_delta) need a "previous" service snapshot to
// compute deltas. Without a persistent snapshot, those detectors return
// [] on every cron run. The 4 detectors that DO work via cron:
//   - daily_snapshot
//   - daily_new_sellers
//   - daily_new_buyers
//   - daily_volume_delta
// If supply-side coverage on cron becomes important, persist the
// snapshot in `indexer_state` via lib/db.ts:setState. Keep state itself
// stateless on cron (each run reports yesterday in full); the snapshot
// is the only piece that needs cross-run continuity.

import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { runDetectors } from "@/lib/signals/run";
import { authorizedBearer } from "@/lib/operatorAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function resolveOutDir(): string {
  if (process.env.ANTFEED_SIGNALS_DIR) {
    return path.resolve(process.env.ANTFEED_SIGNALS_DIR);
  }
  // On Vercel: no sibling antfeed repo. We pass a tmp path so runDetectors'
  // outDir argument is well-typed; dryRun:true means nothing is actually
  // written there.
  return path.join(os.tmpdir(), "antfeed-signals");
}

export async function GET(req: NextRequest) {
  if (!authorizedBearer(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const outDir = resolveOutDir();
    const r = await runDetectors({ outDir, dryRun: true });
    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      detected: r.detected,
      signals: r.signals.map((s) => ({
        kind: s.kind,
        key: s.key,
        headline: s.headline,
        importance: s.importance,
      })),
    });
  } catch (e: any) {
    console.error("[cron/signals] failed", e);
    return NextResponse.json(
      { ok: false, error: "signals_failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
