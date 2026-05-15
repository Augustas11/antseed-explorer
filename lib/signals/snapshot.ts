// Service-supply snapshot persistence for the daily delta detectors.
//
// Each daily run takes a snapshot of which services are offered by which
// providers, then diffs against the previous run's snapshot to surface
// supply-side movement (new service offered, provider count change).
//
// File layout in the signals outDir:
//   .service-snapshot.json       ← current
//   .service-snapshot.prev.json  ← previous (rotated in on each run)
//
// On first ever run there is no .prev — detectors must handle that by
// emitting no delta cards (a fresh snapshot is taken but nothing to
// compare). On subsequent runs .prev is the baseline.

import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { emptySnapshot, type ServiceSnapshot } from "./types";

function currentPath(outDir: string): string {
  return path.join(outDir, ".service-snapshot.json");
}

function prevPath(outDir: string): string {
  return path.join(outDir, ".service-snapshot.prev.json");
}

export function loadCurrentSnapshot(outDir: string): ServiceSnapshot | null {
  const p = currentPath(outDir);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as ServiceSnapshot;
}

export function loadPrevSnapshot(outDir: string): ServiceSnapshot | null {
  const p = prevPath(outDir);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as ServiceSnapshot;
}

// Compute the current snapshot directly from provider_directory. Reads
// every provider's `services` JSON array and counts the providers per
// service. Cheap query — directory is small.
export async function takeSnapshot(): Promise<ServiceSnapshot> {
  const rows = (
    await db.execute<{ services: string | null }>(sql`
      SELECT services FROM provider_directory
    `)
  ).rows;

  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.services) continue;
    let list: string[] = [];
    try {
      list = JSON.parse(r.services) as string[];
    } catch {
      continue;
    }
    const seen = new Set(list); // de-dup per provider just in case
    for (const svc of seen) counts[svc] = (counts[svc] ?? 0) + 1;
  }

  return {
    takenAt: new Date().toISOString(),
    serviceProviderCounts: counts,
    knownServices: Object.keys(counts).sort(),
  };
}

// Rotate current → prev, write fresh current. Atomic-ish: writes via
// tmp+rename so a crash mid-write can't corrupt the active file.
// Returns the (prev, current) pair the detectors will diff.
export function rotateSnapshot(
  outDir: string,
  fresh: ServiceSnapshot,
): { prev: ServiceSnapshot | null; current: ServiceSnapshot } {
  fs.mkdirSync(outDir, { recursive: true });
  const cur = loadCurrentSnapshot(outDir);
  if (cur) {
    // Move existing current → prev (overwriting older prev).
    fs.writeFileSync(prevPath(outDir), JSON.stringify(cur, null, 2));
  }
  // Write fresh current via tmp+rename.
  const tmp = `${currentPath(outDir)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(fresh, null, 2));
  fs.renameSync(tmp, currentPath(outDir));
  return { prev: cur, current: fresh };
}

// Diff helpers used by detectors. Pure functions; easy to unit-test.

export function newlyOfferedServices(
  prev: ServiceSnapshot | null,
  current: ServiceSnapshot,
): string[] {
  if (!prev) return [];
  const before = new Set(prev.knownServices);
  return current.knownServices.filter((s) => !before.has(s));
}

export interface ServiceProviderDelta {
  service: string;
  prevCount: number;
  currentCount: number;
  delta: number;
}

export function serviceProviderDeltas(
  prev: ServiceSnapshot | null,
  current: ServiceSnapshot,
): ServiceProviderDelta[] {
  if (!prev) return [];
  const out: ServiceProviderDelta[] = [];
  const services = new Set<string>([
    ...Object.keys(prev.serviceProviderCounts),
    ...Object.keys(current.serviceProviderCounts),
  ]);
  for (const svc of services) {
    const prevCount = prev.serviceProviderCounts[svc] ?? 0;
    const currentCount = current.serviceProviderCounts[svc] ?? 0;
    if (prevCount !== currentCount) {
      out.push({ service: svc, prevCount, currentCount, delta: currentCount - prevCount });
    }
  }
  // Sort by abs(delta) DESC, then by service name for stability.
  out.sort(
    (a, b) =>
      Math.abs(b.delta) - Math.abs(a.delta) ||
      a.service.localeCompare(b.service),
  );
  return out;
}

export { emptySnapshot };
