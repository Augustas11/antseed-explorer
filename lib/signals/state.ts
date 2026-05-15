// State persistence for the signal detector.
//
// Stored as a single JSON file next to the output directory so the state and
// the cards travel together. Atomic write via tmp+rename so a crash mid-write
// can't corrupt the file.

import fs from "node:fs";
import path from "node:path";
import { emptyState, type SignalState } from "./types";

export function stateFilePath(outDir: string): string {
  return path.join(outDir, ".signal-state.json");
}

export function loadState(outDir: string): SignalState {
  const p = stateFilePath(outDir);
  if (!fs.existsSync(p)) return emptyState();
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<SignalState>;
    return {
      ...emptyState(),
      ...parsed,
      lastEmittedDayByKind: parsed.lastEmittedDayByKind ?? {},
    };
  } catch (e) {
    // Don't silently swallow — bail loud so a corrupt state doesn't
    // produce a flood of duplicate signals on the next run.
    throw new Error(`signal state at ${p} is unreadable: ${(e as Error).message}`);
  }
}

export function saveState(outDir: string, state: SignalState): void {
  fs.mkdirSync(outDir, { recursive: true });
  const p = stateFilePath(outDir);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, p);
}
