// Daily delta detectors. Each function:
//   - Computes the "yesterday" UTC window from the run timestamp.
//   - Queries the explorer DB for what changed in that window.
//   - Returns Signal[] (typically 0 or 1 card).
//   - Skips silently when there is nothing to say (the dominant case).
//
// The state mutation (marking signals as emitted for the day) happens in
// the orchestrator after the renderer succeeds. Detectors are pure-ish:
// only side effect is DB reads. They take an `asOf` timestamp so tests
// and re-runs are deterministic.

import { sql } from "drizzle-orm";
import { db } from "../db";
import type { ServiceSnapshot, Signal } from "./types";
import {
  newlyOfferedServices,
  serviceProviderDeltas,
} from "./snapshot";

const SECONDS_PER_DAY = 86_400;

// Yesterday's UTC midnight-to-midnight bounds + the ISO date label for
// dedup keys. The "as of" parameter is when the run is happening; we
// always look back one full UTC day.
export function yesterdayWindow(asOf: Date): {
  startTs: number;
  endTs: number;
  isoDate: string;
} {
  const todayStart = Math.floor(
    Date.UTC(
      asOf.getUTCFullYear(),
      asOf.getUTCMonth(),
      asOf.getUTCDate(),
    ) / 1000,
  );
  const startTs = todayStart - SECONDS_PER_DAY;
  const endTs = todayStart;
  const isoDate = new Date(startTs * 1000).toISOString().slice(0, 10);
  return { startTs, endTs, isoDate };
}

// ----------------------------------------------------------------------------
// 1. Daily snapshot — always emits
// ----------------------------------------------------------------------------
// "Yesterday in numbers" — the recap shape from the operator's existing
// `May 11 · colony snapshot` posts. Even quiet days produce a card; the
// writer decides whether to publish.

export async function detectDailySnapshot(asOf: Date): Promise<Signal[]> {
  const { startTs, endTs, isoDate } = yesterdayWindow(asOf);

  const r = await db.execute<any>(sql`
    SELECT
      COUNT(*) FILTER (WHERE event_type = 'settled')::int                          AS sessions,
      COALESCE(SUM(delta_usdc) FILTER (WHERE event_type = 'settled'), 0)::float    AS volume_usdc,
      COUNT(DISTINCT buyer_address) FILTER (WHERE event_type = 'settled')::int     AS active_buyers,
      COUNT(DISTINCT seller_address) FILTER (WHERE event_type = 'settled')::int    AS active_sellers
    FROM events
    WHERE timestamp IS NOT NULL
      AND timestamp >= ${sql.raw(String(startTs))}
      AND timestamp < ${sql.raw(String(endTs))}
  `);
  const row = r.rows[0] ?? {};
  const sessions = Number(row.sessions ?? 0);
  const volumeUsdc = Number(row.volume_usdc ?? 0);
  const activeBuyers = Number(row.active_buyers ?? 0);
  const activeSellers = Number(row.active_sellers ?? 0);

  return [
    {
      kind: "daily_snapshot",
      key: `daily-snapshot-${isoDate}`,
      occurredAt: endTs - 1,
      // Snapshots are baseline content — moderate importance unless the
      // day was unusually busy.
      importance: sessions > 0 ? 55 : 40,
      headline: `${isoDate} · colony snapshot: ${sessions} sessions, ${fmtUsd(volumeUsdc)} settled, ${activeBuyers} active buyers, ${activeSellers} active sellers.`,
      facts: {
        day: isoDate,
        sessions,
        volume_usdc: round(volumeUsdc, 4),
        active_buyers: activeBuyers,
        active_sellers: activeSellers,
      },
      link: "https://antfeed.org",
    },
  ];
}

// ----------------------------------------------------------------------------
// 2. First-time-active sellers — emits when ≥1 seller had their first SETTLED
//    session yesterday (not just any event)
// ----------------------------------------------------------------------------
// Semantic: "yesterday was this seller's first time earning USDC on AntSeed."
//
// IMPORTANT — we filter to event_type='settled' explicitly. Earlier versions
// of this detector counted ANY first-ever event (including `Reserved`, which
// is just a buyer opening a channel with that seller — the seller may never
// have actually settled anything). That over-counts and reads as "signups"
// when there were none. Settlement is the only event the seller controls.
//
// We DO NOT have a `created_at` column on `provider_directory`, so true
// "signed up to the directory" can't be detected. "First time settled" is
// the closest honest signal for "new active provider".

export async function detectDailyNewSellers(asOf: Date): Promise<Signal[]> {
  const { startTs, endTs, isoDate } = yesterdayWindow(asOf);

  const r = await db.execute<any>(sql`
    SELECT seller_address, first_settled_ts
    FROM (
      SELECT seller_address, MIN(timestamp) AS first_settled_ts
      FROM events
      WHERE seller_address IS NOT NULL
        AND event_type = 'settled'
        AND timestamp IS NOT NULL
        AND timestamp > 0
        AND timestamp < 32503680000
      GROUP BY seller_address
    ) s
    WHERE first_settled_ts >= ${sql.raw(String(startTs))}
      AND first_settled_ts <  ${sql.raw(String(endTs))}
    ORDER BY first_settled_ts ASC
  `);
  const newSellers = r.rows.map((x: any) => ({
    address: String(x.seller_address).toLowerCase(),
    firstSettledTs: Number(x.first_settled_ts),
  }));
  if (newSellers.length === 0) return [];

  // Look up display names. Multiple seller addresses can share a display
  // name (e.g., AntSeed itself runs several nodes all called "Antseed
  // Node"), so we COUNT BY NAME and present repeats as `Name (×N)` rather
  // than listing the name twice.
  const displayNames = await lookupDisplayNames(newSellers.map((s) => s.address));
  const namedCounts = new Map<string, number>();
  let unnamedCount = 0;
  for (const s of newSellers) {
    const n = displayNames.get(s.address);
    if (n) namedCounts.set(n, (namedCounts.get(n) ?? 0) + 1);
    else unnamedCount += 1;
  }

  // Stable order: by count DESC, then alphabetical. Cap at 3 unique names
  // shown — listing many named entities reads as a directory dump.
  const namedSorted = [...namedCounts.entries()].sort(
    ([na, ca], [nb, cb]) => cb - ca || na.localeCompare(nb),
  );
  const SHOW_LIMIT = 3;
  const shown = namedSorted.slice(0, SHOW_LIMIT);
  const hidden = namedSorted.slice(SHOW_LIMIT);
  const featured = shown
    .map(([name, n]) => (n > 1 ? `${name} (×${n})` : name))
    .join(", ");
  // "remainder" = total sellers NOT represented in `featured`. Hidden
  // named entities contribute their counts; all unnamed addresses contribute.
  const remainderCount =
    hidden.reduce((acc, [, n]) => acc + n, 0) + unnamedCount;

  const totalCount = newSellers.length;

  return [
    {
      kind: "daily_new_sellers",
      key: `daily-new-sellers-${isoDate}`,
      occurredAt: endTs - 1,
      importance: 70,
      headline: `${totalCount} seller${totalCount === 1 ? "" : "s"} settled their first session on AntSeed on ${isoDate}.`,
      facts: {
        day: isoDate,
        count: totalCount,
        featured: featured || "—",
        remainder_count: remainderCount,
        named_unique_count: namedCounts.size,
        unnamed_count: unnamedCount,
      },
      link: "https://antfeed.org",
    },
  ];
}

// ----------------------------------------------------------------------------
// 3. New buyers — emits when ≥3 new buyer addresses appeared yesterday
// ----------------------------------------------------------------------------
// Floor of 3 because the network sees ≥1 new buyer most days; that's not
// noteworthy. ≥3 is "cohort" territory and worth a card.

const NEW_BUYERS_FLOOR = 3;

export async function detectDailyNewBuyers(asOf: Date): Promise<Signal[]> {
  const { startTs, endTs, isoDate } = yesterdayWindow(asOf);

  const r = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM buyer_profiles
    WHERE first_seen_ts IS NOT NULL
      AND first_seen_ts >= ${sql.raw(String(startTs))}
      AND first_seen_ts <  ${sql.raw(String(endTs))}
  `);
  const count = Number(r.rows[0]?.count ?? 0);
  if (count < NEW_BUYERS_FLOOR) return [];

  return [
    {
      kind: "daily_new_buyers",
      key: `daily-new-buyers-${isoDate}`,
      occurredAt: endTs - 1,
      importance: count >= 10 ? 75 : 60,
      headline: `${count} new buyers emerged on ${isoDate}.`,
      facts: {
        day: isoDate,
        count,
      },
      link: "https://antfeed.org/buyers",
    },
  ];
}

// ----------------------------------------------------------------------------
// 4. New service offered — emits when a service appeared since last snapshot
// ----------------------------------------------------------------------------

export async function detectDailyNewServiceOffered(
  asOf: Date,
  prev: ServiceSnapshot | null,
  current: ServiceSnapshot,
): Promise<Signal[]> {
  const newOnes = newlyOfferedServices(prev, current);
  if (newOnes.length === 0) return [];

  const { isoDate, endTs } = yesterdayWindow(asOf);
  return [
    {
      kind: "daily_new_service_offered",
      key: `daily-new-service-${isoDate}-${slugList(newOnes)}`,
      occurredAt: endTs - 1,
      importance: 65,
      headline: `${newOnes.length === 1 ? `${newOnes[0]} newly available on AntSeed` : `${newOnes.length} new services available on AntSeed`} (${isoDate}).`,
      facts: {
        day: isoDate,
        services: newOnes.join(", "),
        count: newOnes.length,
        // Provider counts at the time of detection, for context.
        provider_counts: newOnes
          .map((s) => `${s}=${current.serviceProviderCounts[s] ?? 0}`)
          .join(", "),
      },
      link: "https://antfeed.org",
    },
  ];
}

// ----------------------------------------------------------------------------
// 5. Service supply delta — emits when any service's provider count moved
// ----------------------------------------------------------------------------
// Caps the top 3 by magnitude of change so the card stays readable.
// Excludes services that are simply new (those go through #4) — we don't
// want to double-emit.

export async function detectDailyServiceSupplyDelta(
  asOf: Date,
  prev: ServiceSnapshot | null,
  current: ServiceSnapshot,
): Promise<Signal[]> {
  if (!prev) return [];
  const newOnes = new Set(newlyOfferedServices(prev, current));
  const deltas = serviceProviderDeltas(prev, current).filter(
    (d) => !newOnes.has(d.service),
  );
  if (deltas.length === 0) return [];
  const top = deltas.slice(0, 3);

  const { isoDate, endTs } = yesterdayWindow(asOf);
  const topLine = top
    .map(
      (d) =>
        `${d.service}: ${d.currentCount} provider${d.currentCount === 1 ? "" : "s"} (${d.delta >= 0 ? "+" : ""}${d.delta})`,
    )
    .join(", ");

  return [
    {
      kind: "daily_service_supply_delta",
      key: `daily-supply-delta-${isoDate}`,
      occurredAt: endTs - 1,
      importance: 60,
      headline: `service supply moved on ${isoDate}: ${topLine}.`,
      facts: {
        day: isoDate,
        movers: topLine,
        full_count: deltas.length,
      },
      link: "https://antfeed.org",
    },
  ];
}

// ----------------------------------------------------------------------------
// 6. Volume delta — emits when yesterday's volume is ≥30% above/below
//    the trailing 7-day average
// ----------------------------------------------------------------------------

const VOLUME_DELTA_THRESHOLD = 0.30; // ±30%

export async function detectDailyVolumeDelta(asOf: Date): Promise<Signal[]> {
  const { startTs, endTs, isoDate } = yesterdayWindow(asOf);
  const trailingStart = startTs - 7 * SECONDS_PER_DAY;

  const r = await db.execute<any>(sql`
    SELECT
      COALESCE(SUM(delta_usdc) FILTER (WHERE timestamp >= ${sql.raw(String(startTs))} AND timestamp < ${sql.raw(String(endTs))}), 0)::float
        AS yesterday_volume,
      COALESCE(SUM(delta_usdc) FILTER (WHERE timestamp >= ${sql.raw(String(trailingStart))} AND timestamp < ${sql.raw(String(startTs))}), 0)::float
        AS trailing_volume
    FROM events
    WHERE event_type = 'settled'
      AND timestamp IS NOT NULL
      AND timestamp > 0
      AND timestamp < 32503680000
  `);
  const row = r.rows[0] ?? {};
  const yesterdayVol = Number(row.yesterday_volume ?? 0);
  const trailingTotal = Number(row.trailing_volume ?? 0);
  const trailingAvg = trailingTotal / 7;

  // Skip when there's no baseline yet (trailing avg = 0) — comparison
  // meaningless. Also skip when yesterday was a true zero day; saying
  // "-100% vs avg" reads as alarmist.
  if (trailingAvg <= 0 || yesterdayVol <= 0) return [];

  const pctChange = (yesterdayVol - trailingAvg) / trailingAvg;
  if (Math.abs(pctChange) < VOLUME_DELTA_THRESHOLD) return [];

  const direction = pctChange > 0 ? "above" : "below";
  const pctLabel = `${pctChange >= 0 ? "+" : ""}${Math.round(pctChange * 100)}%`;

  return [
    {
      kind: "daily_volume_delta",
      key: `daily-volume-delta-${isoDate}`,
      occurredAt: endTs - 1,
      importance: Math.abs(pctChange) >= 0.75 ? 80 : 65,
      headline: `${isoDate} settled volume ${pctLabel} vs trailing 7d avg (${fmtUsd(yesterdayVol)} vs ${fmtUsd(trailingAvg)}/day).`,
      facts: {
        day: isoDate,
        yesterday_volume_usdc: round(yesterdayVol, 4),
        trailing_7d_avg_usdc: round(trailingAvg, 4),
        pct_change: round(pctChange * 100, 1),
        direction,
      },
      link: "https://antfeed.org",
    },
  ];
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

async function lookupDisplayNames(
  addresses: string[],
): Promise<Map<string, string>> {
  if (addresses.length === 0) return new Map();
  const safe = addresses
    .map((a) => a.toLowerCase())
    .filter((a) => /^0x[0-9a-f]{40}$/.test(a))
    .map((a) => `'${a}'`)
    .join(",");
  if (!safe) return new Map();
  const rows = (
    await db.execute<{ address: string; display_name: string | null }>(sql`
      SELECT address, display_name FROM provider_directory
      WHERE address IN (${sql.raw(safe)}) AND display_name IS NOT NULL
    `)
  ).rows;
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r.display_name) m.set(r.address, r.display_name);
  }
  return m;
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtUsd(n: number): string {
  if (n >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function round(n: number, dp: number): number {
  const k = Math.pow(10, dp);
  return Math.round(n * k) / k;
}

function slugList(items: string[]): string {
  // Stable short slug for filenames when ≥1 service names are listed.
  // Just the first item, lowercased + cleaned, so re-runs same day produce
  // the same filename even if the order changes.
  const head = items[0] ?? "service";
  return head.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
}
