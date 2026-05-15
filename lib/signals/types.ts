// Shared types for the signal detection pipeline.
//
// Model: **daily delta recap**. Every run computes deltas for "yesterday"
// vs prior baseline (trailing 7-day average for volume, prior day's
// snapshot for service supply, all-time for first-seen entities). A signal
// fires only when there is something to say — most kinds skip silently on
// quiet days. The detector is daily-keyed via ISO date, so re-running the
// same day produces no new files.
//
// The threshold-milestone model that preceded this (volume/qualified-count
// ladders) was retired 2026-05-15: it produced 77 cards in one run, most
// noise, with a first-run-from-zero bug. The replacement is editorial-by-
// construction — every emitted card describes a movement that happened,
// not a static state crossing an arbitrary line.

export type SignalKind =
  | "daily_snapshot"
  | "daily_new_sellers"
  | "daily_new_buyers"
  | "daily_new_service_offered"
  | "daily_service_supply_delta"
  | "daily_volume_delta";

export interface Signal {
  kind: SignalKind;
  // Stable dedup key. Includes the ISO date so re-running the same day
  // produces no new files. Example: `daily-snapshot-2026-05-15`.
  key: string;
  // Unix seconds — when the underlying event(s) happened (typically the
  // end-of-yesterday timestamp for daily-window detectors).
  occurredAt: number;
  // 0-100 self-assessed newsworthiness. Helps the writer prioritize when
  // many cards fire on the same day. Not a hard filter.
  importance: number;
  // Human-facing one-liner the writer can adapt. Keep under ~140 chars.
  headline: string;
  // Structured facts the writer threads into copy. Anything that should
  // appear verbatim in a post (numbers, addresses, dates) goes here.
  facts: Record<string, string | number | boolean | null>;
  // Optional URL on antfeed.org that the post can link to / screenshot.
  link?: string;
  // Optional extra paragraphs (longer context, caveats, comparison data).
  context?: string;
}

export interface SignalState {
  // ISO8601 of last successful run.
  lastRunAt: string | null;
  // ISO date string (YYYY-MM-DD) of the last day each kind was emitted.
  // The orchestrator skips a kind if today's date is already present.
  // Re-running the same day is idempotent.
  lastEmittedDayByKind: Partial<Record<SignalKind, string>>;
}

export function emptyState(): SignalState {
  return {
    lastRunAt: null,
    lastEmittedDayByKind: {},
  };
}

// Per-service snapshot used to compute supply-side deltas.
// Stored alongside the signal state as `.service-snapshot.json`; rotated
// to `.service-snapshot.prev.json` on each daily run before being
// overwritten. The detectors compare current state to .prev. First run
// produces a snapshot but no delta cards (no baseline to compare).
export interface ServiceSnapshot {
  takenAt: string; // ISO8601
  // Map from service name → number of providers offering it.
  serviceProviderCounts: Record<string, number>;
  // Set of all service names known. Used to detect newly-offered services.
  knownServices: string[];
}

export function emptySnapshot(): ServiceSnapshot {
  return {
    takenAt: new Date(0).toISOString(),
    serviceProviderCounts: {},
    knownServices: [],
  };
}
