// Orchestrator. Runs every detector, dedupes by ISO date so re-runs the
// same UTC day produce no new files. Side effects (when not dry-run):
//   - writes signal cards under outDir
//   - writes state file (.signal-state.json) under outDir
//   - rotates service snapshot (.service-snapshot.{json,prev.json})

import fs from "node:fs";
import path from "node:path";
import {
  detectDailyNewBuyers,
  detectDailyNewSellers,
  detectDailyNewServiceOffered,
  detectDailyServiceSupplyDelta,
  detectDailySnapshot,
  detectDailyVolumeDelta,
  yesterdayWindow,
} from "./detectors";
import { renderCard } from "./render";
import { loadState, saveState } from "./state";
import {
  loadPrevSnapshot,
  rotateSnapshot,
  takeSnapshot,
} from "./snapshot";
import type { Signal } from "./types";

export interface RunOptions {
  outDir: string;
  dryRun?: boolean;
  // Override "now" for tests / backfill. Defaults to actual current time.
  asOf?: Date;
}

export interface RunResult {
  detected: number;
  written: number;
  skippedAlreadyEmittedToday: number;
  skippedFileExists: number;
  signals: Array<{
    kind: Signal["kind"];
    key: string;
    headline: string;
    importance: number;
    filename: string;
    written: boolean;
    // Full rendered card body (markdown). Kept for local/operator callers;
    // HTTP cron routes must not serialize it because it includes writer
    // guidance that can be persisted in logs.
    body: string;
  }>;
}

export async function runDetectors(opts: RunOptions): Promise<RunResult> {
  const asOf = opts.asOf ?? new Date();
  const { isoDate: yesterdayIso } = yesterdayWindow(asOf);
  const state = loadState(opts.outDir);

  // Snapshot rotation runs first so the supply-side detectors can see the
  // prev snapshot. In dry-run we still take a fresh snapshot in memory
  // but don't write it to disk — keeps reads consistent without polluting
  // state on a test run.
  const fresh = await takeSnapshot();
  let prev = loadPrevSnapshot(opts.outDir);
  if (!opts.dryRun) {
    const rotated = rotateSnapshot(opts.outDir, fresh);
    // After the first rotation .prev is the old current, which is what
    // we want to diff against. Re-load to be sure.
    prev = rotated.prev;
  }

  const buckets = await Promise.all([
    detectDailySnapshot(asOf),
    detectDailyNewSellers(asOf),
    detectDailyNewBuyers(asOf),
    detectDailyNewServiceOffered(asOf, prev, fresh),
    detectDailyServiceSupplyDelta(asOf, prev, fresh),
    detectDailyVolumeDelta(asOf),
  ]);
  const detected = buckets.flat();

  // Stable order: importance DESC, then occurredAt DESC, then key for tie-break.
  detected.sort(
    (a, b) =>
      b.importance - a.importance ||
      b.occurredAt - a.occurredAt ||
      a.key.localeCompare(b.key),
  );

  const result: RunResult = {
    detected: detected.length,
    written: 0,
    skippedAlreadyEmittedToday: 0,
    skippedFileExists: 0,
    signals: [],
  };

  if (!opts.dryRun) fs.mkdirSync(opts.outDir, { recursive: true });

  for (const s of detected) {
    const alreadyToday =
      state.lastEmittedDayByKind[s.kind] === yesterdayIso;
    const card = renderCard(s);
    const full = path.join(opts.outDir, card.filename);
    const fileExists = fs.existsSync(full);
    let written = false;

    if (alreadyToday) {
      result.skippedAlreadyEmittedToday += 1;
    } else if (fileExists) {
      // Card file already on disk (manual write or prior aborted run).
      // Mark state so we don't fight with it.
      state.lastEmittedDayByKind[s.kind] = yesterdayIso;
      result.skippedFileExists += 1;
    } else if (!opts.dryRun) {
      fs.writeFileSync(full, card.body);
      state.lastEmittedDayByKind[s.kind] = yesterdayIso;
      result.written += 1;
      written = true;
    }

    result.signals.push({
      kind: s.kind,
      key: s.key,
      headline: s.headline,
      importance: s.importance,
      filename: card.filename,
      written,
      body: card.body,
    });
  }

  if (!opts.dryRun) {
    state.lastRunAt = new Date().toISOString();
    saveState(opts.outDir, state);
  }
  return result;
}
