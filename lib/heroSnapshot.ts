export interface HeroStats {
  // Network Revenue — settled USDC across the network
  totalRevenueUsdc: number;
  recentRevenueUsdc: number;
  priorRevenueUsdc: number;
  // Tokens Consumed — sum of input+output from settled metadata
  totalTokens: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  recentTokens: number;
  priorTokens: number;
  // Paying Users — distinct addresses that paid USDC, claimed $ANTS, or are
  // active in the Diem provider-capacity pool. When diemExactAddresses is
  // false, DIEM contributes a count-only synthetic cohort and the total is an
  // upper-bound estimate because wallet-level de-duplication is not possible.
  totalPayingUsers: number;
  recentPayingUsers: number;
  priorPayingUsers: number;
  // Sub-counts so the UI can attribute the headline to its sources.
  usdcPayers: number;
  antsClaimers: number;
  diemPoolUsers: number;
  diemExactAddresses: boolean;
}

export interface HeroSparklinePoint {
  day: string;
  revenue: number;
  tokens: number;
  paying_users: number;
}

export interface HeroSnapshot {
  at: number;
  source: HeroSnapshotSource;
  stats: HeroStats;
  sparklines: HeroSparklinePoint[];
}

export interface HeroSnapshotSource {
  lastSyncTs: number | null;
  lastHeadBlock: number | null;
  lastIndexedBlock: number | null;
  lastIndexedBlockStats: number | null;
  lastIndexedBlockAnts: number | null;
  lastIndexedBlockEmissions: number | null;
  diemSnapshotAt: number | null;
  diemExactAddresses: boolean;
}

export interface HeroSnapshotStatus {
  stale: boolean;
  reason: "fresh" | "legacy" | "missing_sync_watermark" | "stale_sync_watermark";
}

export const HERO_SNAPSHOT_STALE_AFTER_MS = 30 * 60_000;

const HERO_STAT_KEYS = [
  "totalRevenueUsdc",
  "recentRevenueUsdc",
  "priorRevenueUsdc",
  "totalTokens",
  "totalTokensInput",
  "totalTokensOutput",
  "recentTokens",
  "priorTokens",
  "totalPayingUsers",
  "recentPayingUsers",
  "priorPayingUsers",
  "usdcPayers",
  "antsClaimers",
  "diemPoolUsers",
] as const satisfies readonly (keyof HeroStats)[];

const HERO_SOURCE_KEYS = [
  "lastSyncTs",
  "lastHeadBlock",
  "lastIndexedBlock",
  "lastIndexedBlockStats",
  "lastIndexedBlockAnts",
  "lastIndexedBlockEmissions",
  "diemSnapshotAt",
] as const satisfies readonly (keyof HeroSnapshotSource)[];

function finiteMetric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateHeroSnapshot(value: unknown): HeroSnapshot | null {
  const parsed = value as Partial<HeroSnapshot>;
  if (
    typeof parsed?.at !== "number" ||
    !Number.isFinite(parsed.at) ||
    !parsed.stats ||
    !Array.isArray(parsed.sparklines)
  ) {
    return null;
  }

  for (const key of HERO_STAT_KEYS) {
    if (!finiteMetric(parsed.stats[key])) return null;
  }
  const diemExactAddresses = (parsed.stats as Partial<HeroStats>).diemExactAddresses === true;

  for (const point of parsed.sparklines as Partial<HeroSparklinePoint>[]) {
    if (
      typeof point?.day !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(point.day) ||
      !finiteMetric(point.revenue) ||
      !finiteMetric(point.tokens) ||
      !finiteMetric(point.paying_users)
    ) {
      return null;
    }
  }

  const source = validateHeroSnapshotSource(parsed.source, {
    diemExactAddresses,
  });
  if (!source) return null;

  return {
    at: parsed.at,
    source,
    stats: {
      ...(parsed.stats as HeroStats),
      diemExactAddresses,
    },
    sparklines: parsed.sparklines as HeroSparklinePoint[],
  };
}

function finiteNullableMetric(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function validateHeroSnapshotSource(
  value: unknown,
  fallback: { diemExactAddresses: boolean },
): HeroSnapshotSource | null {
  if (value == null) {
    return {
      lastSyncTs: null,
      lastHeadBlock: null,
      lastIndexedBlock: null,
      lastIndexedBlockStats: null,
      lastIndexedBlockAnts: null,
      lastIndexedBlockEmissions: null,
      diemSnapshotAt: null,
      diemExactAddresses: fallback.diemExactAddresses,
    };
  }
  const source = value as Partial<HeroSnapshotSource>;
  if (!source || typeof source !== "object") return null;
  for (const key of HERO_SOURCE_KEYS) {
    if (!finiteNullableMetric(source[key])) return null;
  }
  return {
    lastSyncTs: source.lastSyncTs ?? null,
    lastHeadBlock: source.lastHeadBlock ?? null,
    lastIndexedBlock: source.lastIndexedBlock ?? null,
    lastIndexedBlockStats: source.lastIndexedBlockStats ?? null,
    lastIndexedBlockAnts: source.lastIndexedBlockAnts ?? null,
    lastIndexedBlockEmissions: source.lastIndexedBlockEmissions ?? null,
    diemSnapshotAt: source.diemSnapshotAt ?? null,
    diemExactAddresses: source.diemExactAddresses === true,
  };
}

export function getHeroSnapshotStatus(
  snapshot: HeroSnapshot,
  now = Date.now(),
): HeroSnapshotStatus {
  if (
    snapshot.source.lastSyncTs == null &&
    snapshot.source.lastIndexedBlock == null &&
    snapshot.source.lastHeadBlock == null
  ) {
    return { stale: true, reason: "legacy" };
  }
  if (snapshot.source.lastSyncTs == null) {
    return { stale: true, reason: "missing_sync_watermark" };
  }
  if (now - snapshot.source.lastSyncTs > HERO_SNAPSHOT_STALE_AFTER_MS) {
    return { stale: true, reason: "stale_sync_watermark" };
  }
  return { stale: false, reason: "fresh" };
}
