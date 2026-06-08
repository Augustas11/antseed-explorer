import { db, getState, setState } from "./db";
import {
  events as eventsTbl,
  buyerProfiles,
  providerDirectory,
  indexerState,
} from "./schema";
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  isNotNull,
  sql,
} from "drizzle-orm";
import { cache as reactCache } from "react";
import { canonicalize, groupServices, type ServiceGroup } from "./services-canonical";
import { getActiveDiemPoolUsers, getDiemPoolSnapshotMetadata } from "./diem";
import { createTtlCache } from "./ttlCache";
import {
  rawAddressList,
  rawFiniteNumber,
  rawNonNegativeInteger,
  rawPositiveInteger,
  rawSqlFragment,
  rawStringLiteralList,
  rawTextValuesSelect,
} from "./sqlSafe";
import {
  CHANNEL_DEFAULT_SORT,
  PROVIDER_DEFAULT_SORT,
  SELLER_DEFAULT_SORT,
  type BuyerSort,
  type ChannelSort,
  type ProviderSort,
  type SellerSort,
} from "./publicApiContract";
import {
  validateHeroSnapshot,
  type HeroSnapshot,
  type HeroSnapshotSource,
  type HeroSparklinePoint,
  type HeroStats,
} from "./heroSnapshot";
export {
  validateHeroSnapshot,
  type HeroSnapshot,
  type HeroSnapshotSource,
  type HeroSparklinePoint,
  type HeroStats,
} from "./heroSnapshot";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ADDRESS_PREFIX_RE = /^0x[0-9a-f]{4,40}$/;
const cache: typeof reactCache =
  typeof reactCache === "function" ? reactCache : (((fn: any) => fn) as typeof reactCache);
const CHANNEL_EVENT_TYPES = [
  "reserved",
  "settled",
  "closed",
  "topup",
  "withdrawn",
  "close_requested",
] as const;
const CHANNEL_EVENT_TYPES_SQL = rawStringLiteralList(
  CHANNEL_EVENT_TYPES,
  (value) => /^[a-z_]+$/.test(value),
  "channel event types",
);
const HOT_PAGE_AGGREGATE_CACHE_TTL_MS = 5 * 60_000;

function cleanPositiveInt(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

function cleanNonNegativeInt(value: unknown, fallback = 0, max = 100_000): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(n)));
}

function cleanScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function cleanDirection(value: unknown, fallback: "asc" | "desc"): "asc" | "desc" {
  return value === "asc" || value === "desc" ? value : fallback;
}

function safeTokenCount(value: unknown, label: string): number {
  if (value == null) return 0;
  try {
    const count = BigInt(value as string | number | bigint);
    if (count < 0n) {
      console.warn(`[queries] negative ${label} token count ignored`);
      return 0;
    }
    if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
      console.warn(`[queries] ${label} token count exceeds Number.MAX_SAFE_INTEGER; clamping`);
      return Number.MAX_SAFE_INTEGER;
    }
    return Number(count);
  } catch {
    console.warn(`[queries] invalid ${label} token count ignored`);
    return 0;
  }
}

export function isExplorerAddress(value: string): boolean {
  return ADDRESS_RE.test(value);
}

// Public row shape kept identical to the SQLite era so the UI doesn't have to
// change. Drizzle returns camelCase from the schema; we re-shape on the way out.

export interface BuyerRow {
  address: string;
  total_sessions: number;
  total_settled_usdc: number;
  unique_sellers: number;
  ghost_sessions: number;
  first_seen_block: number | null;
  last_seen_block: number | null;
  first_seen_ts: number | null;
  last_seen_ts: number | null;
  trust_score: number;
  qualified: number; // 0/1 to keep the UI happy
}

function shapeBuyer(r: typeof buyerProfiles.$inferSelect): BuyerRow {
  return {
    address: r.address,
    total_sessions: r.totalSessions ?? 0,
    total_settled_usdc: r.totalSettledUsdc ?? 0,
    unique_sellers: r.uniqueSellers ?? 0,
    ghost_sessions: r.ghostSessions ?? 0,
    first_seen_block: r.firstSeenBlock,
    last_seen_block: r.lastSeenBlock,
    first_seen_ts: r.firstSeenTs,
    last_seen_ts: r.lastSeenTs,
    trust_score: r.trustScore ?? 0,
    qualified: r.qualified ? 1 : 0,
  };
}

export async function listBuyers(opts: {
  limit?: number;
  offset?: number;
  qualifiedOnly?: boolean;
  minScore?: number;
  sort?: BuyerSort;
} = {}): Promise<BuyerRow[]> {
  const limit = cleanPositiveInt(opts.limit, 25, 100);
  const offset = cleanNonNegativeInt(opts.offset);
  const minScore = cleanScore(opts.minScore);
  const orderCol =
    opts.sort === "volume" ? "total_settled_usdc DESC"
    : opts.sort === "sessions" ? "total_sessions DESC"
    : opts.sort === "first_seen" ? "first_seen_block ASC NULLS LAST"
    : opts.sort === "unique_sellers" ? "unique_sellers DESC"
    : opts.sort === "ghosts" ? "ghost_sessions DESC"
    : "trust_score DESC";
  const qualClause = opts.qualifiedOnly ? "AND qualified = true" : "";
  const allowedOrderCols = [
    "total_settled_usdc DESC",
    "total_sessions DESC",
    "first_seen_block ASC NULLS LAST",
    "unique_sellers DESC",
    "ghost_sessions DESC",
    "trust_score DESC",
  ];

  // Raw SQL — Drizzle's chained query builder under Neon HTTP returned empty
  // rows for specific (sort, limit) combinations on Vercel cold starts.
  // No user input is interpolated; all values are sanitized integers / fixed enum strings.
  const r = await db.execute<any>(sql`
    SELECT * FROM buyer_profiles
    WHERE trust_score >= ${rawFiniteNumber(minScore, "buyer min score", { min: 0, max: 100 })}
    ${rawSqlFragment(qualClause, ["", "AND qualified = true"], "buyer qualification clause")}
    ORDER BY ${rawSqlFragment(orderCol, allowedOrderCols, "buyer order clause")}
    LIMIT ${rawPositiveInteger(limit, "buyer limit")}
    OFFSET ${rawNonNegativeInteger(offset, "buyer offset")}
  `);
  return r.rows.map((row: any) =>
    shapeBuyer({
      address: row.address,
      totalSessions: Number(row.total_sessions ?? 0),
      totalSettledUsdc: Number(row.total_settled_usdc ?? 0),
      uniqueSellers: Number(row.unique_sellers ?? 0),
      ghostSessions: Number(row.ghost_sessions ?? 0),
      firstSeenBlock: row.first_seen_block != null ? Number(row.first_seen_block) : null,
      lastSeenBlock: row.last_seen_block != null ? Number(row.last_seen_block) : null,
      firstSeenTs: row.first_seen_ts != null ? Number(row.first_seen_ts) : null,
      lastSeenTs: row.last_seen_ts != null ? Number(row.last_seen_ts) : null,
      trustScore: Number(row.trust_score ?? 0),
      qualified: !!row.qualified,
      updatedAt: row.updated_at != null ? Number(row.updated_at) : null,
    })
  );
}

export async function countBuyers(opts: {
  qualifiedOnly?: boolean;
  minScore?: number;
} = {}): Promise<number> {
  const minScore = cleanScore(opts.minScore);
  const qualClause = opts.qualifiedOnly ? "AND qualified = true" : "";
  const r = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM buyer_profiles
    WHERE trust_score >= ${rawFiniteNumber(minScore, "buyer count min score", { min: 0, max: 100 })}
    ${rawSqlFragment(qualClause, ["", "AND qualified = true"], "buyer count qualification clause")}
  `);
  return Number(r.rows[0]?.n ?? 0);
}

async function getBuyerUncached(address: string): Promise<BuyerRow | null> {
  if (!isExplorerAddress(address)) return null;
  const r = await db.execute<any>(sql`
    SELECT * FROM buyer_profiles WHERE address = ${address.toLowerCase()} LIMIT 1
  `);
  const row = r.rows[0];
  if (!row) return null;
  return shapeBuyer({
    address: row.address,
    totalSessions: Number(row.total_sessions ?? 0),
    totalSettledUsdc: Number(row.total_settled_usdc ?? 0),
    uniqueSellers: Number(row.unique_sellers ?? 0),
    ghostSessions: Number(row.ghost_sessions ?? 0),
    firstSeenBlock: row.first_seen_block != null ? Number(row.first_seen_block) : null,
    lastSeenBlock: row.last_seen_block != null ? Number(row.last_seen_block) : null,
    firstSeenTs: row.first_seen_ts != null ? Number(row.first_seen_ts) : null,
    lastSeenTs: row.last_seen_ts != null ? Number(row.last_seen_ts) : null,
    trustScore: Number(row.trust_score ?? 0),
    qualified: !!row.qualified,
    updatedAt: row.updated_at != null ? Number(row.updated_at) : null,
  });
}

export const getBuyer = cache(getBuyerUncached);

export async function getBuyerSessions(address: string, limit = 25) {
  if (!isExplorerAddress(address)) return [];
  const safeLimit = cleanPositiveInt(limit, 25, 100);
  const r = await db.execute<any>(sql`
    SELECT tx_hash, log_index, block_number, event_type, buyer_address, seller_address,
           channel_id, delta_usdc, settled_amount_usdc, input_tokens, output_tokens,
           request_count, timestamp
    FROM events
    WHERE buyer_address = ${address.toLowerCase()}
    ORDER BY block_number DESC, log_index DESC
    LIMIT ${rawPositiveInteger(safeLimit, "buyer sessions limit")}
  `);
  return r.rows.map((e: any) => ({
    tx_hash: e.tx_hash,
    log_index: e.log_index != null ? Number(e.log_index) : null,
    block_number: Number(e.block_number),
    event_type: e.event_type,
    buyer_address: e.buyer_address,
    seller_address: e.seller_address,
    channel_id: e.channel_id,
    delta_usdc: e.delta_usdc != null ? Number(e.delta_usdc) : null,
    settled_amount_usdc:
      e.settled_amount_usdc != null ? Number(e.settled_amount_usdc) : null,
    input_tokens: e.input_tokens != null ? Number(e.input_tokens) : null,
    output_tokens: e.output_tokens != null ? Number(e.output_tokens) : null,
    request_count: e.request_count != null ? Number(e.request_count) : null,
    timestamp: e.timestamp != null ? Number(e.timestamp) : null,
  }));
}

export async function getBuyerMonthlyVolume(address: string) {
  if (!isExplorerAddress(address)) return [];
  const rows = await db.execute<{
    month: string;
    sessions: number;
    volume: number;
  }>(sql`
    SELECT to_char(to_timestamp(timestamp::float8), 'YYYY-MM') AS month,
           COUNT(*)::int AS sessions,
           COALESCE(SUM(delta_usdc),0)::float AS volume
    FROM events
    WHERE buyer_address = ${address.toLowerCase()}
      AND event_type = 'settled'
      AND timestamp IS NOT NULL AND timestamp > 0 AND timestamp < 32503680000
    GROUP BY month
    ORDER BY month ASC
  `);
  return rows.rows;
}

export async function getBuyerDailyVolume(address: string, days = 30) {
  if (!isExplorerAddress(address)) return [];
  const d = cleanPositiveInt(days, 30, 10_000);
  const rows = await db.execute<{
    bucket: string;
    sessions: number;
    volume: number;
  }>(sql`
    SELECT to_char(to_timestamp(timestamp), 'YYYY-MM-DD') AS bucket,
           COUNT(*)::int AS sessions,
           COALESCE(SUM(delta_usdc),0)::float AS volume
    FROM events
    WHERE buyer_address = ${address.toLowerCase()}
      AND event_type = 'settled'
      AND timestamp IS NOT NULL AND timestamp > 0 AND timestamp < 32503680000
      AND timestamp > extract(epoch from now())::bigint - ${rawPositiveInteger(d, "buyer daily window days")} * 86400
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  return rows.rows;
}

export async function getBuyerHourlyVolume(address: string, hours = 24) {
  if (!isExplorerAddress(address)) return [];
  const h = cleanPositiveInt(hours, 24, 24 * 365);
  const rows = await db.execute<{
    bucket: string;
    sessions: number;
    volume: number;
  }>(sql`
    SELECT to_char(to_timestamp(timestamp), 'YYYY-MM-DD HH24:00') AS bucket,
           COUNT(*)::int AS sessions,
           COALESCE(SUM(delta_usdc),0)::float AS volume
    FROM events
    WHERE buyer_address = ${address.toLowerCase()}
      AND event_type = 'settled'
      AND timestamp IS NOT NULL
      AND timestamp > extract(epoch from now())::bigint - ${rawPositiveInteger(h, "buyer hourly window hours")} * 3600
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  return rows.rows;
}

export interface BuyerSellerSummary extends Record<string, unknown> {
  seller_address: string;
  sessions: number;
  total_usdc: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_requests: number;
}

export async function getBuyerSellerSummary(
  address: string,
  limit = 10,
): Promise<BuyerSellerSummary[]> {
  if (!isExplorerAddress(address)) return [];
  const safeLimit = cleanPositiveInt(limit, 10, 100);
  const rows = await db.execute<BuyerSellerSummary>(sql`
    SELECT seller_address,
           COUNT(*)::int AS sessions,
           COALESCE(SUM(delta_usdc),0)::float AS total_usdc,
           COALESCE(SUM(input_tokens),0)::bigint AS total_input_tokens,
           COALESCE(SUM(output_tokens),0)::bigint AS total_output_tokens,
           COALESCE(SUM(request_count),0)::int AS total_requests
    FROM events
    WHERE buyer_address = ${address.toLowerCase()}
      AND event_type = 'settled'
    GROUP BY seller_address
    ORDER BY total_usdc DESC
    LIMIT ${rawPositiveInteger(safeLimit, "buyer seller summary limit")}
  `);
  // bigint -> number for JSON friendliness in the UI
  return rows.rows.map((r: any) => ({
    ...r,
    total_input_tokens: safeTokenCount(r.total_input_tokens, "buyer seller input"),
    total_output_tokens: safeTokenCount(r.total_output_tokens, "buyer seller output"),
  }));
}

export async function getNetworkStats() {
  // One round-trip — combine all aggregates into a single query.
  // Avoids serverless cold-start connection-setup races with Neon's HTTP driver.
  const r = await db.execute<{
    total_buyers: number;
    qualified_buyers: number;
    total_volume: number;
    total_sessions: number;
    total_ghosts: number;
    metadata_records: number;
    ants_claims: number;
    ants_holders_nonzero: number;
    last_indexed_block: string | null;
    last_head_block: string | null;
    last_sync_ts: string | null;
    last_indexed_block_stats: string | null;
    last_indexed_block_ants: string | null;
    last_indexed_block_emissions: string | null;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM buyer_profiles) AS total_buyers,
      (SELECT COUNT(*)::int FROM buyer_profiles WHERE qualified = true) AS qualified_buyers,
      (SELECT COALESCE(SUM(total_settled_usdc),0)::float FROM buyer_profiles) AS total_volume,
      (SELECT COALESCE(SUM(total_sessions),0)::int FROM buyer_profiles) AS total_sessions,
      (SELECT COALESCE(SUM(ghost_sessions),0)::int FROM buyer_profiles) AS total_ghosts,
      (SELECT COUNT(*)::int FROM events WHERE event_type = 'metadata_recorded') AS metadata_records,
      (SELECT COUNT(*)::int FROM events WHERE event_type = 'ants_claim') AS ants_claims,
      (SELECT COUNT(*)::int FROM ants_holders WHERE balance + staked_balance > 0) AS ants_holders_nonzero,
      (SELECT value FROM indexer_state WHERE key = 'last_indexed_block') AS last_indexed_block,
      (SELECT value FROM indexer_state WHERE key = 'last_head_block') AS last_head_block,
      (SELECT value FROM indexer_state WHERE key = 'last_sync_ts') AS last_sync_ts,
      (SELECT value FROM indexer_state WHERE key = 'last_indexed_block_antseed_stats') AS last_indexed_block_stats,
      (SELECT value FROM indexer_state WHERE key = 'last_indexed_block_ants_token') AS last_indexed_block_ants,
      (SELECT value FROM indexer_state WHERE key = 'last_indexed_block_emissions') AS last_indexed_block_emissions
  `);
  const x = r.rows[0];
  return {
    totalBuyers: Number(x?.total_buyers ?? 0),
    qualifiedBuyers: Number(x?.qualified_buyers ?? 0),
    totalVolumeUsdc: Number(x?.total_volume ?? 0),
    totalSessions: Number(x?.total_sessions ?? 0),
    totalGhosts: Number(x?.total_ghosts ?? 0),
    metadataRecords: Number(x?.metadata_records ?? 0),
    antsClaims: Number(x?.ants_claims ?? 0),
    antsHoldersNonZero: Number(x?.ants_holders_nonzero ?? 0),
    lastIndexedBlock: x?.last_indexed_block ? Number(x.last_indexed_block) : null,
    lastHeadBlock: x?.last_head_block ? Number(x.last_head_block) : null,
    lastSyncTs: x?.last_sync_ts ? Number(x.last_sync_ts) : null,
    lastIndexedBlockStats: x?.last_indexed_block_stats ? Number(x.last_indexed_block_stats) : null,
    lastIndexedBlockAnts: x?.last_indexed_block_ants ? Number(x.last_indexed_block_ants) : null,
    lastIndexedBlockEmissions: x?.last_indexed_block_emissions ? Number(x.last_indexed_block_emissions) : null,
  };
}

const HERO_SNAPSHOT_KEY = "hero_snapshot";
const HERO_SNAPSHOT_CACHE_TTL_MS = 30_000;

let heroSnapshotCache: { at: number; snapshot: HeroSnapshot } | null = null;

async function readHeroSnapshot(): Promise<HeroSnapshot | null> {
  const now = Date.now();
  if (heroSnapshotCache && now - heroSnapshotCache.at < HERO_SNAPSHOT_CACHE_TTL_MS) {
    return heroSnapshotCache.snapshot;
  }
  try {
    const raw = await getState(HERO_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = validateHeroSnapshot(JSON.parse(raw));
    if (!parsed) return null;
    heroSnapshotCache = { at: now, snapshot: parsed };
    return parsed;
  } catch (e: any) {
    console.warn("[hero] failed to read hero snapshot", e?.message ?? e);
    return null;
  }
}

async function writeHeroSnapshot(snapshot: HeroSnapshot) {
  await setState(HERO_SNAPSHOT_KEY, JSON.stringify(snapshot));
  heroSnapshotCache = { at: Date.now(), snapshot };
}

export async function refreshHeroSnapshot(): Promise<HeroSnapshot> {
  const [stats, sparklines, network, diem] = await Promise.all([
    computeHeroStats(),
    computeHeroSparklines(),
    getNetworkStats(),
    getDiemPoolSnapshotMetadata(),
  ]);
  const snapshot: HeroSnapshot = {
    at: Date.now(),
    source: heroSnapshotSource(network, diem),
    stats,
    sparklines,
  };
  await writeHeroSnapshot(snapshot);
  return snapshot;
}

export async function getHeroSnapshot(): Promise<HeroSnapshot | null> {
  return readHeroSnapshot();
}

export async function getHeroStats(): Promise<HeroStats | null> {
  return (await readHeroSnapshot())?.stats ?? null;
}

async function computeHeroStats(): Promise<HeroStats> {
  // Window cutoffs are guarded raw integers because Neon HTTP has been
  // unreliable with bound JS numbers inside bigint arithmetic.
  const now = Math.floor(Date.now() / 1000);
  const day30 = now - 30 * 86400;
  const day60 = now - 60 * 86400;

  const diemPool = await getActiveDiemPoolUsers();
  const diemAddresses = diemPool.addresses
    .map((address) => address.toLowerCase())
    .filter((address) => ADDRESS_RE.test(address));
  const diemPoolUsersCte =
    diemPool.exactAddresses && diemAddresses.length > 0
      ? rawTextValuesSelect(
          diemAddresses,
          "addr",
          (value) => ADDRESS_RE.test(value),
          "DIEM pool addresses",
        )
      : sql`SELECT ('diem_pool_user_' || n)::text AS addr FROM generate_series(1, ${rawNonNegativeInteger(diemPool.count, "diem pool count")}) AS n`;

  // Revenue: SUM(delta_usdc) per ChannelSettled event — delta is the
  // per-batch amount actually moved.
  //
  // Tokens: SUM over AntseedStats.MetadataRecorded events. That contract's
  // recordMetadata is called by authorized writers per inference call, and
  // the event fires the per-call (input, output, requestCount) tuple — so
  // SUM is exact and matches the Dune board. ChannelSettled.metadata is
  // seller-provided opaque bytes (cumulative or null depending on seller
  // convention) and is not used here.
  //
  // Paying Users: distinct over the union of (a) addresses that sent USDC via
  // a Deposited event (tx.from, not event.buyer — deposit() accepts a caller-
  // supplied buyer param so args.buyer ≠ real payer), (b) addresses that
  // claimed $ANTS, and (c) wallets currently active in the Diem provider-
  // capacity pool. Diem exposes live stakerCount; when DIEM_ENUMERATE_USERS=1
  // and the RPC supports historical logs, we also de-dupe exact DIEM addresses.
  const r = await db.execute<any>(sql`
    WITH settled AS (
      SELECT timestamp, delta_usdc
      FROM events
      WHERE event_type = 'settled'
        AND timestamp IS NOT NULL
        AND timestamp > 0
        AND timestamp < 32503680000
    ),
    tok AS (
      SELECT
        timestamp,
        COALESCE(input_tokens, 0)  AS in_tok,
        COALESCE(output_tokens, 0) AS out_tok
      FROM events
      WHERE event_type = 'metadata_recorded'
        AND timestamp IS NOT NULL
        AND timestamp > 0
        AND timestamp < 32503680000
    ),
    usdc_payers AS (
      SELECT buyer_address AS addr,
             bool_or(timestamp > ${rawNonNegativeInteger(day30, "hero 30-day cutoff")}) AS active_recent,
             bool_or(timestamp > ${rawNonNegativeInteger(day60, "hero 60-day cutoff")} AND timestamp <= ${rawNonNegativeInteger(day30, "hero 30-day cutoff")}) AS active_prior
      FROM events
      WHERE event_type = 'deposited'
        AND buyer_address IS NOT NULL
        AND timestamp IS NOT NULL
        AND timestamp > 0
      GROUP BY buyer_address
    ),
    ants_claimers AS (
      SELECT buyer_address AS addr,
             bool_or(timestamp > ${rawNonNegativeInteger(day30, "hero 30-day cutoff")}) AS active_recent,
             bool_or(timestamp > ${rawNonNegativeInteger(day60, "hero 60-day cutoff")} AND timestamp <= ${rawNonNegativeInteger(day30, "hero 30-day cutoff")}) AS active_prior
      FROM events
      WHERE event_type = 'ants_claim'
        AND buyer_address IS NOT NULL
        AND timestamp IS NOT NULL
        AND timestamp > 0
      GROUP BY buyer_address
    ),
    diem_pool_users AS (
      ${diemPoolUsersCte}
    ),
    paying AS (
      SELECT addr,
             bool_or(active_recent) AS active_recent,
             bool_or(active_prior)  AS active_prior
      FROM (
        SELECT addr, active_recent, active_prior FROM usdc_payers
        UNION ALL
        SELECT addr, active_recent, active_prior FROM ants_claimers
        UNION ALL
        SELECT addr, TRUE AS active_recent, FALSE AS active_prior FROM diem_pool_users
      ) u
      GROUP BY addr
    )
    SELECT
      (SELECT COALESCE(SUM(in_tok + out_tok),0)::bigint FROM tok) AS total_tokens,
      (SELECT COALESCE(SUM(in_tok),0)::bigint           FROM tok) AS total_tokens_input,
      (SELECT COALESCE(SUM(out_tok),0)::bigint          FROM tok) AS total_tokens_output,
      (SELECT COALESCE(SUM(in_tok + out_tok),0)::bigint FROM tok WHERE timestamp > ${rawNonNegativeInteger(day30, "hero 30-day cutoff")}) AS recent_tokens,
      (SELECT COALESCE(SUM(in_tok + out_tok),0)::bigint FROM tok WHERE timestamp > ${rawNonNegativeInteger(day60, "hero 60-day cutoff")} AND timestamp <= ${rawNonNegativeInteger(day30, "hero 30-day cutoff")}) AS prior_tokens,

      (SELECT COALESCE(SUM(delta_usdc),0)::float        FROM settled) AS total_revenue,
      (SELECT COALESCE(SUM(delta_usdc),0)::float        FROM settled WHERE timestamp > ${rawNonNegativeInteger(day30, "hero 30-day cutoff")}) AS recent_revenue,
      (SELECT COALESCE(SUM(delta_usdc),0)::float        FROM settled WHERE timestamp > ${rawNonNegativeInteger(day60, "hero 60-day cutoff")} AND timestamp <= ${rawNonNegativeInteger(day30, "hero 30-day cutoff")}) AS prior_revenue,

      (SELECT COUNT(*)::int                             FROM paying) AS total_paying_users,
      (SELECT COUNT(*)::int                             FROM paying WHERE active_recent) AS recent_paying_users,
      (SELECT COUNT(*)::int                             FROM paying WHERE active_prior)  AS prior_paying_users,
      (SELECT COUNT(*)::int                             FROM usdc_payers) AS usdc_payers,
      (SELECT COUNT(*)::int                             FROM ants_claimers) AS ants_claimers,
      (SELECT COUNT(*)::int                             FROM diem_pool_users) AS diem_pool_users
  `);

  const x = r.rows[0] ?? {};
  return {
    totalRevenueUsdc: Number(x.total_revenue ?? 0),
    recentRevenueUsdc: Number(x.recent_revenue ?? 0),
    priorRevenueUsdc: Number(x.prior_revenue ?? 0),
    totalTokens: safeTokenCount(x.total_tokens, "hero total"),
    totalTokensInput: safeTokenCount(x.total_tokens_input, "hero total input"),
    totalTokensOutput: safeTokenCount(x.total_tokens_output, "hero total output"),
    recentTokens: safeTokenCount(x.recent_tokens, "hero recent"),
    priorTokens: safeTokenCount(x.prior_tokens, "hero prior"),
    totalPayingUsers: Number(x.total_paying_users ?? 0),
    recentPayingUsers: Number(x.recent_paying_users ?? 0),
    priorPayingUsers: Number(x.prior_paying_users ?? 0),
    usdcPayers: Number(x.usdc_payers ?? 0),
    antsClaimers: Number(x.ants_claimers ?? 0),
    diemPoolUsers: Number(x.diem_pool_users ?? 0),
    diemExactAddresses: diemPool.exactAddresses,
  };
}

function heroSnapshotSource(
  network: Awaited<ReturnType<typeof getNetworkStats>>,
  diem: Awaited<ReturnType<typeof getDiemPoolSnapshotMetadata>>,
): HeroSnapshotSource {
  const indexedBlocks = [
    network.lastIndexedBlock,
    network.lastIndexedBlockStats,
    network.lastIndexedBlockAnts,
    network.lastIndexedBlockEmissions,
  ].filter((value): value is number => value != null && Number.isFinite(value));
  return {
    lastSyncTs: network.lastSyncTs,
    lastHeadBlock: network.lastHeadBlock,
    lastIndexedBlock: indexedBlocks.length ? Math.max(...indexedBlocks) : null,
    lastIndexedBlockStats: network.lastIndexedBlockStats,
    lastIndexedBlockAnts: network.lastIndexedBlockAnts,
    lastIndexedBlockEmissions: network.lastIndexedBlockEmissions,
    diemSnapshotAt: diem.at,
    diemExactAddresses: diem.exactAddresses,
  };
}

export interface TokenBucket {
  day: string;
  in_tokens: number;
  out_tokens: number;
  total_tokens: number;
}

// 30d daily series for the three hero KPIs in a single round-trip. Used to
// draw the sparkline under each hero card; not enough resolution for real
// charts, just shape signal. Tokens come from MetadataRecorded events
// (canonical, matches the hero card source).
export async function getHeroSparklines(): Promise<HeroSparklinePoint[] | null> {
  return (await readHeroSnapshot())?.sparklines ?? null;
}

async function computeHeroSparklines(): Promise<HeroSparklinePoint[]> {
  const diemPool = await getActiveDiemPoolUsers();
  const diemPoolCount = diemPool.count;
  const diemAddresses = diemPool.addresses
    .map((address) => address.toLowerCase())
    .filter((address) => ADDRESS_RE.test(address));
  const diemPoolUsersCte =
    diemPool.exactAddresses && diemAddresses.length > 0
      ? rawTextValuesSelect(
          diemAddresses,
          "addr",
          (value) => ADDRESS_RE.test(value),
          "DIEM pool sparkline addresses",
        )
      : sql`SELECT NULL::text AS addr WHERE FALSE`;
  const rows = await db.execute<any>(sql`
    WITH days AS (
      SELECT generate_series(
        date_trunc('day', to_timestamp(extract(epoch from now())::bigint - 29 * 86400)),
        date_trunc('day', to_timestamp(extract(epoch from now())::bigint)),
        interval '1 day'
      )::date AS d
    ),
    rev AS (
      SELECT to_char(to_timestamp(timestamp), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(delta_usdc),0)::float AS revenue
      FROM events
      WHERE event_type = 'settled'
        AND timestamp IS NOT NULL
        AND timestamp > 0
        AND timestamp > extract(epoch from now())::bigint - 30 * 86400
      GROUP BY day
    ),
    paying_events AS (
      SELECT to_char(to_timestamp(timestamp), 'YYYY-MM-DD') AS day,
             buyer_address AS addr
      FROM events
      WHERE event_type IN ('deposited', 'ants_claim')
        AND buyer_address IS NOT NULL
        AND timestamp IS NOT NULL
        AND timestamp > 0
        AND timestamp > extract(epoch from now())::bigint - 30 * 86400
    ),
    diem_pool_users AS (
      ${diemPoolUsersCte}
    ),
    today_paying AS (
      SELECT COUNT(DISTINCT addr)::int AS paying_users
      FROM (
        SELECT addr
        FROM paying_events
        WHERE day = to_char(date_trunc('day', to_timestamp(extract(epoch from now())::bigint)), 'YYYY-MM-DD')
        UNION ALL
        SELECT addr FROM diem_pool_users
      ) u
    ),
    payers AS (
      SELECT day, COUNT(DISTINCT addr)::int AS paying_users
      FROM paying_events
      GROUP BY day
    ),
    tok AS (
      SELECT to_char(to_timestamp(timestamp), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(
               COALESCE(input_tokens,0) + COALESCE(output_tokens,0)
             ),0)::bigint AS tokens
      FROM events
      WHERE event_type='metadata_recorded'
        AND timestamp IS NOT NULL
        AND timestamp > 0
        AND timestamp > extract(epoch from now())::bigint - 30 * 86400
      GROUP BY day
    )
    SELECT to_char(d, 'YYYY-MM-DD')              AS day,
           COALESCE(rev.revenue, 0)::float       AS revenue,
           COALESCE(tok.tokens, 0)::bigint       AS tokens,
           (
             COALESCE(payers.paying_users, 0)::int
             + CASE
                 WHEN d = date_trunc('day', to_timestamp(extract(epoch from now())::bigint))::date
                 THEN ${
                   diemPool.exactAddresses
                     ? sql`GREATEST(0, COALESCE(today_paying.paying_users, 0) - COALESCE(payers.paying_users, 0))`
                     : rawNonNegativeInteger(diemPoolCount, "diem pool count")
                 }
                 ELSE 0
               END
           )::int AS paying_users
    FROM days
    LEFT JOIN rev    ON rev.day    = to_char(d, 'YYYY-MM-DD')
    LEFT JOIN payers ON payers.day = to_char(d, 'YYYY-MM-DD')
    LEFT JOIN tok    ON tok.day    = to_char(d, 'YYYY-MM-DD')
    CROSS JOIN today_paying
    ORDER BY d ASC
  `);
  return rows.rows.map((r: any) => ({
    day: r.day,
    revenue: Number(r.revenue ?? 0),
    tokens: safeTokenCount(r.tokens, "hero sparkline"),
    paying_users: Number(r.paying_users ?? 0),
  }));
}

// Daily/hourly token throughput from the canonical AntseedStats events.
// Per-call deltas, so SUM is the right shape; matches Dune's daily card.
export async function getDailyTokens(days = 30): Promise<TokenBucket[]> {
  const d = cleanPositiveInt(days, 30, 10_000);
  const rows = await db.execute<any>(sql`
    SELECT to_char(to_timestamp(timestamp), 'YYYY-MM-DD') AS day,
           COALESCE(SUM(input_tokens),0)::bigint  AS in_tokens,
           COALESCE(SUM(output_tokens),0)::bigint AS out_tokens,
           COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)),0)::bigint AS total_tokens
    FROM events
    WHERE event_type='metadata_recorded'
      AND timestamp IS NOT NULL
      AND timestamp > 0
      AND timestamp > extract(epoch from now())::bigint - ${rawPositiveInteger(d, "daily token window days")} * 86400
    GROUP BY day
    ORDER BY day ASC
  `);
  return rows.rows.map((r: any) => ({
    day: r.day,
    in_tokens: safeTokenCount(r.in_tokens, "daily input"),
    out_tokens: safeTokenCount(r.out_tokens, "daily output"),
    total_tokens: safeTokenCount(r.total_tokens, "daily total"),
  }));
}

export async function getHourlyTokens(hours = 24): Promise<TokenBucket[]> {
  const h = cleanPositiveInt(hours, 24, 24 * 365);
  const rows = await db.execute<any>(sql`
    SELECT to_char(to_timestamp(timestamp), 'YYYY-MM-DD HH24:00') AS day,
           COALESCE(SUM(input_tokens),0)::bigint  AS in_tokens,
           COALESCE(SUM(output_tokens),0)::bigint AS out_tokens,
           COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)),0)::bigint AS total_tokens
    FROM events
    WHERE event_type='metadata_recorded'
      AND timestamp IS NOT NULL
      AND timestamp > 0
      AND timestamp > extract(epoch from now())::bigint - ${rawPositiveInteger(h, "hourly token window hours")} * 3600
    GROUP BY day
    ORDER BY day ASC
  `);
  return rows.rows.map((r: any) => ({
    day: r.day,
    in_tokens: safeTokenCount(r.in_tokens, "hourly input"),
    out_tokens: safeTokenCount(r.out_tokens, "hourly output"),
    total_tokens: safeTokenCount(r.total_tokens, "hourly total"),
  }));
}

export async function getDailyVolume(days = 30) {
  // Guarded raw integer — Drizzle's parameterized binding via Neon HTTP
  // returns empty rows for arithmetic on bigint columns when the param is a
  // plain JS number; raw inlining works reliably.
  const d = cleanPositiveInt(days, 30, 10_000);
  const rows = await db.execute<{
    day: string;
    sessions: number;
    volume: number;
    active_buyers: number;
    daily_active_users: number;
    new_users: number;
  }>(sql`
    WITH vol AS (
      SELECT to_char(to_timestamp(timestamp), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS sessions,
             COALESCE(SUM(delta_usdc),0)::float AS volume,
             COUNT(DISTINCT buyer_address)::int AS active_buyers
      FROM events
      WHERE event_type='settled'
        AND timestamp IS NOT NULL
        AND timestamp > extract(epoch from now())::bigint - ${rawPositiveInteger(d, "daily volume window days")} * 86400
      GROUP BY 1
    )
    SELECT v.day,
           v.sessions,
           v.volume,
           v.active_buyers,
           COALESCE(dd.dau, 0)::int      AS daily_active_users,
           COALESCE(dd.new_users, 0)::int AS new_users
    FROM vol v
    LEFT JOIN daily_dau dd ON dd.day = v.day::date
    ORDER BY v.day ASC
  `);
  return rows.rows;
}

export interface EpochRevenueBucket {
  epoch: number;
  label: string;
  volume: number;
  sessions: number;
}

export interface EpochAnalytics {
  currentEpoch: number;
  startTs: number;
  endTs: number;
  durationSec: number;
  epochRevenueUsdc: number;
  activeSellers: number;
  source: "contract" | "time-fallback";
  todo: string | null;
  buckets: EpochRevenueBucket[];
}

export async function getEpochAnalytics(clock: {
  currentEpoch: number;
  startTs: number;
  endTs: number;
  durationSec: number;
  source: "contract" | "time-fallback";
  todo: string | null;
}): Promise<EpochAnalytics> {
  const currentEpoch = cleanNonNegativeInt(clock.currentEpoch, 0, 10_000);
  const durationSec = cleanPositiveInt(clock.durationSec, 7 * 86400, 366 * 86400);
  const epochZeroTs = clock.startTs - currentEpoch * durationSec;
  const minEpoch = Math.max(0, currentEpoch - 23);
  const maxEpoch = currentEpoch;
  const rows = await db.execute<{
    epoch: number;
    volume: number;
    sessions: number;
    active_sellers: number;
  }>(sql`
    WITH params AS (
      SELECT
        ${rawNonNegativeInteger(epochZeroTs, "epoch zero timestamp")}::bigint AS epoch_zero,
        ${rawPositiveInteger(durationSec, "epoch duration seconds")}::bigint AS epoch_seconds,
        ${rawNonNegativeInteger(minEpoch, "minimum epoch")}::int AS min_epoch,
        ${rawNonNegativeInteger(maxEpoch, "maximum epoch")}::int AS max_epoch
    ),
    epochs AS (
      SELECT generate_series(min_epoch, max_epoch)::int AS epoch FROM params
    ),
    settled AS (
      SELECT
        floor((timestamp - params.epoch_zero)::numeric / params.epoch_seconds)::int AS epoch,
        COALESCE(delta_usdc, 0)::float AS delta_usdc,
        seller_address
      FROM events, params
      WHERE event_type = 'settled'
        AND timestamp IS NOT NULL
        AND timestamp >= params.epoch_zero + params.min_epoch * params.epoch_seconds
        AND timestamp < params.epoch_zero + (params.max_epoch + 1) * params.epoch_seconds
    )
    SELECT
      epochs.epoch,
      COALESCE(SUM(settled.delta_usdc), 0)::float AS volume,
      COUNT(settled.delta_usdc)::int AS sessions,
      COUNT(DISTINCT settled.seller_address)::int AS active_sellers
    FROM epochs
    LEFT JOIN settled ON settled.epoch = epochs.epoch
    GROUP BY epochs.epoch
    ORDER BY epochs.epoch ASC
  `);
  const buckets = rows.rows.map((row) => ({
    epoch: Number(row.epoch),
    label: `E${Number(row.epoch)}`,
    volume: Number(row.volume ?? 0),
    sessions: Number(row.sessions ?? 0),
  }));
  const current = rows.rows.find((row) => Number(row.epoch) === currentEpoch);
  return {
    currentEpoch,
    startTs: clock.startTs,
    endTs: clock.endTs,
    durationSec,
    epochRevenueUsdc: Number(current?.volume ?? 0),
    activeSellers: Number(current?.active_sellers ?? 0),
    source: clock.source,
    todo: clock.todo,
    buckets,
  };
}

export interface DailyMetricsRow {
  day: string;
  dau: number;
  newUsers: number;
  settledUsdc: number;
  feesUsdc: number;
  settles: number;
  requests: number;
  tokens: number;
}

export async function getDailyMetricsTable(days: number): Promise<DailyMetricsRow[]> {
  const d = cleanPositiveInt(days, 14, 90);
  const rows = await db.execute<{
    day: string;
    dau: number;
    new_users: number;
    settled_usdc: number;
    fees_usdc: number;
    settles: number;
    requests: string | number | null;
    tokens: string | number | null;
  }>(sql`
    WITH days AS (
      SELECT generate_series(
        date_trunc('day', to_timestamp(extract(epoch from now())::bigint - (${rawPositiveInteger(d, "daily metrics days")} - 1) * 86400)),
        date_trunc('day', to_timestamp(extract(epoch from now())::bigint)),
        interval '1 day'
      )::date AS day
    ),
    settled AS (
      SELECT
        to_timestamp(timestamp)::date AS day,
        COALESCE(SUM(delta_usdc), 0)::float AS settled_usdc,
        COALESCE(SUM(platform_fee_usdc), 0)::float AS fees_usdc,
        COUNT(*)::int AS settles
      FROM events
      WHERE event_type = 'settled'
        AND timestamp IS NOT NULL
        AND timestamp > 0
        AND timestamp > extract(epoch from now())::bigint - ${rawPositiveInteger(d, "daily metrics settle window days")} * 86400
      GROUP BY 1
    ),
    metadata AS (
      SELECT
        to_timestamp(timestamp)::date AS day,
        COALESCE(SUM(request_count), 0)::bigint AS requests,
        COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)::bigint AS tokens
      FROM events
      WHERE event_type = 'metadata_recorded'
        AND timestamp IS NOT NULL
        AND timestamp > 0
        AND timestamp > extract(epoch from now())::bigint - ${rawPositiveInteger(d, "daily metrics token window days")} * 86400
      GROUP BY 1
    )
    SELECT
      to_char(days.day, 'YYYY-MM-DD') AS day,
      COALESCE(daily_dau.dau, 0)::int AS dau,
      COALESCE(daily_dau.new_users, 0)::int AS new_users,
      COALESCE(settled.settled_usdc, 0)::float AS settled_usdc,
      COALESCE(settled.fees_usdc, 0)::float AS fees_usdc,
      COALESCE(settled.settles, 0)::int AS settles,
      COALESCE(metadata.requests, 0)::bigint AS requests,
      COALESCE(metadata.tokens, 0)::bigint AS tokens
    FROM days
    LEFT JOIN daily_dau ON daily_dau.day = days.day
    LEFT JOIN settled ON settled.day = days.day
    LEFT JOIN metadata ON metadata.day = days.day
    ORDER BY days.day DESC
  `);
  return rows.rows.map((row) => ({
    day: row.day,
    dau: Number(row.dau ?? 0),
    newUsers: Number(row.new_users ?? 0),
    settledUsdc: Number(row.settled_usdc ?? 0),
    feesUsdc: Number(row.fees_usdc ?? 0),
    settles: Number(row.settles ?? 0),
    requests: safeTokenCount(row.requests, "daily metrics requests"),
    tokens: safeTokenCount(row.tokens, "daily metrics tokens"),
  }));
}

export interface BuyerFunnelStage {
  key: "depositors" | "first_session" | "repeat_session" | "active_7d";
  label: string;
  count: number;
  dropoffPct: number | null;
}

async function computeBuyerFunnel(): Promise<BuyerFunnelStage[]> {
  const rows = await db.execute<{
    depositors: number;
    first_session: number;
    repeat_session: number;
    active_7d: number;
  }>(sql`
    WITH depositors AS (
      SELECT DISTINCT buyer_address AS buyer
      FROM events
      WHERE event_type = 'deposited'
        AND buyer_address IS NOT NULL
    ),
    settled AS (
      SELECT
        buyer_address AS buyer,
        COUNT(*)::int AS sessions,
        MIN(timestamp)::bigint AS first_ts,
        MAX(timestamp)::bigint AS last_ts
      FROM events
      WHERE event_type = 'settled'
        AND buyer_address IS NOT NULL
        AND timestamp IS NOT NULL
        AND timestamp > 0
      GROUP BY buyer_address
    )
    SELECT
      (SELECT COUNT(*)::int FROM depositors) AS depositors,
      (SELECT COUNT(*)::int FROM settled WHERE sessions >= 1) AS first_session,
      (SELECT COUNT(*)::int FROM settled WHERE sessions >= 2) AS repeat_session,
      (SELECT COUNT(*)::int FROM settled WHERE sessions >= 2 AND last_ts - first_ts >= 7 * 86400) AS active_7d
  `);
  const row = rows.rows[0] ?? {
    depositors: 0,
    first_session: 0,
    repeat_session: 0,
    active_7d: 0,
  };
  const counts = [
    { key: "depositors" as const, label: "Depositors", count: Number(row.depositors ?? 0) },
    { key: "first_session" as const, label: "First session", count: Number(row.first_session ?? 0) },
    { key: "repeat_session" as const, label: "≥2 sessions", count: Number(row.repeat_session ?? 0) },
    { key: "active_7d" as const, label: "≥7-day active", count: Number(row.active_7d ?? 0) },
  ];
  return counts.map((stage, index) => {
    if (index === 0) return { ...stage, dropoffPct: null };
    const previous = counts[index - 1]?.count ?? 0;
    return {
      ...stage,
      dropoffPct: previous > 0 ? ((previous - stage.count) / previous) * 100 : null,
    };
  });
}

export const getBuyerFunnel = createTtlCache(
  computeBuyerFunnel,
  HOT_PAGE_AGGREGATE_CACHE_TTL_MS,
).get;

export async function getProfileDrift() {
  const rows = await db.execute<{ events_usdc: number; profiles_usdc: number }>(sql`
    SELECT
      (SELECT COALESCE(SUM(delta_usdc),0)::float FROM events WHERE event_type='settled') AS events_usdc,
      (SELECT COALESCE(SUM(total_settled_usdc),0)::float FROM buyer_profiles) AS profiles_usdc
  `);
  const r = rows.rows[0];
  const ev = Number(r?.events_usdc ?? 0);
  const pr = Number(r?.profiles_usdc ?? 0);
  return {
    eventsUsdc: ev,
    profilesUsdc: pr,
    driftUsdc: +(ev - pr).toFixed(6),
  };
}

export interface ProviderRow {
  address: string;
  display_name: string | null;
  peer_id: string | null;
  region: string | null;
  trust_score: number | null;
  services: string[];
  pricing: Record<string, any>;
  description: string | null;
  updated_at: number | null;
  // Non-null when `address` is a seller delegation contract; holds the
  // operator EVM address derived from peerId[:40]. See refreshProviderDirectory.
  operator_address: string | null;
}

async function lookupProviderUncached(
  address: string | null,
): Promise<ProviderRow | null> {
  if (!address) return null;
  const lc = address.toLowerCase();
  // Raw SQL — Drizzle's ORM-style select+where on providerDirectory fails
  // under Neon HTTP on Vercel (same parameterized-binding issue as other
  // tables; see listBuyers and lookupProviders for the same workaround).
  const rows = (
    await db.execute<any>(
      sql`SELECT * FROM provider_directory WHERE address = ${lc} LIMIT 1`,
    )
  ).rows;
  const r = rows[0];
  if (!r) return null;
  return {
    address: r.address,
    display_name: r.display_name,
    peer_id: r.peer_id,
    region: r.region,
    trust_score: r.trust_score,
    services: parseJson<string[]>(r.services) ?? [],
    pricing: parseJson<Record<string, any>>(r.pricing) ?? {},
    description: r.description ?? null,
    updated_at: r.updated_at != null ? Number(r.updated_at) : null,
    operator_address: r.operator_address ?? null,
  };
}

export const lookupProvider = cache(lookupProviderUncached);

// Batch helper: lookup many addresses at once (avoids N+1 queries on the
// buyer profile page).
export async function lookupProviders(
  addresses: (string | null | undefined)[],
): Promise<Map<string, ProviderRow>> {
  const lc = [
    ...new Set(
      addresses.filter((a): a is string => !!a).map((a) => a.toLowerCase()),
    ),
  ];
  if (lc.length === 0) return new Map();
  // Inline the address list — array params via Neon HTTP have been unreliable.
  // Each address is a strict 0x + 40 hex chars, so we sanitize and inline.
  const safe = lc.filter((a) => /^0x[0-9a-f]{40}$/.test(a));
  if (safe.length === 0) return new Map();
  const rows = (
    await db.execute<any>(
      sql`SELECT * FROM provider_directory WHERE address IN (${rawAddressList(safe, "provider lookup addresses")})`,
    )
  ).rows;
  const m = new Map<string, ProviderRow>();
  for (const r of rows) {
    m.set(r.address, {
      address: r.address,
      display_name: r.display_name,
      peer_id: r.peer_id,
      region: r.region,
      trust_score: r.trust_score,
      services: parseJson<string[]>(r.services) ?? [],
      pricing: parseJson<Record<string, any>>(r.pricing) ?? {},
      description: r.description ?? null,
      updated_at: r.updated_at != null ? Number(r.updated_at) : null,
      operator_address: r.operator_address ?? null,
    });
  }
  return m;
}

function parseJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// lookupAddress
// ---------------------------------------------------------------------------

export async function lookupAddress(
  addr: string,
): Promise<{ type: "buyer" | "seller"; address: string } | null> {
  if (!isExplorerAddress(addr)) return null;
  const normalized = addr.toLowerCase();

  const buyerR = await db.execute<{ address: string }>(sql`
    SELECT address FROM buyer_profiles WHERE address = ${normalized} LIMIT 1
  `);
  if (buyerR.rows.length > 0) {
    return { type: "buyer", address: normalized };
  }

  const sellerR = await db.execute<{ seller_address: string }>(sql`
    SELECT seller_address FROM events
    WHERE seller_address = ${normalized}
      AND event_type IN (${CHANNEL_EVENT_TYPES_SQL})
    LIMIT 1
  `);
  if (sellerR.rows.length > 0) {
    return { type: "seller", address: normalized };
  }

  const providerR = await db.execute<{ address: string }>(sql`
    SELECT address FROM provider_directory WHERE address = ${normalized} LIMIT 1
  `);
  if (providerR.rows.length > 0) {
    return { type: "seller", address: normalized };
  }

  return null;
}

// ---------------------------------------------------------------------------
// SellerRow + seller queries
// ---------------------------------------------------------------------------

export interface SellerRow {
  address: string;
  unique_buyers: number;
  total_sessions: number;
  total_earned_usdc: number;
  ghost_sessions: number;
  first_seen_ts: number | null;
  last_seen_ts: number | null;
  first_seen_block: number | null;
  last_seen_block: number | null;
}

function shapeSellerRow(row: any): SellerRow {
  return {
    address: row.address,
    unique_buyers: Number(row.unique_buyers ?? 0),
    total_sessions: Number(row.total_sessions ?? 0),
    total_earned_usdc: Number(row.total_earned_usdc ?? 0),
    ghost_sessions: Number(row.ghost_sessions ?? 0),
    first_seen_ts: row.first_seen_ts != null ? Number(row.first_seen_ts) : null,
    last_seen_ts: row.last_seen_ts != null ? Number(row.last_seen_ts) : null,
    first_seen_block: row.first_seen_block != null ? Number(row.first_seen_block) : null,
    last_seen_block: row.last_seen_block != null ? Number(row.last_seen_block) : null,
  };
}

export async function listSellers(opts: {
  limit?: number;
  offset?: number;
  sort?: SellerSort;
  dir?: "asc" | "desc";
} = {}): Promise<SellerRow[]> {
  const limit = cleanPositiveInt(opts.limit, 25, 100);
  const offset = cleanNonNegativeInt(opts.offset);
  const sortColMap: Record<SellerSort, string> = {
    volume: "total_earned_usdc",
    sessions: "total_sessions",
    buyers: "unique_buyers",
    ghosts: "ghost_sessions",
    first_seen: "first_seen_ts",
  };
  const sortCol = sortColMap[opts.sort ?? SELLER_DEFAULT_SORT] ?? sortColMap[SELLER_DEFAULT_SORT];
  // first_seen defaults to asc; everything else defaults to desc
  const dir = cleanDirection(opts.dir, opts.sort === "first_seen" ? "asc" : "desc");
  const orderExpr = `${sortCol} ${dir.toUpperCase()}`;
  const allowedOrderExprs = Object.values(sortColMap).flatMap((col) => [
    `${col} ASC`,
    `${col} DESC`,
  ]);

  const r = await db.execute<any>(sql`
    SELECT
      seller_address                                                         AS address,
      COUNT(DISTINCT buyer_address)::int                                     AS unique_buyers,
      COUNT(*) FILTER (WHERE event_type = 'settled')::int                    AS total_sessions,
      COALESCE(SUM(delta_usdc) FILTER (WHERE event_type = 'settled'), 0)::float AS total_earned_usdc,
      COUNT(*) FILTER (
        WHERE event_type = 'closed'
          AND COALESCE(settled_amount_usdc,0) = 0
          AND NOT EXISTS (
            SELECT 1 FROM events s WHERE s.channel_id = events.channel_id AND s.event_type='settled'
          )
      )::int AS ghost_sessions,
      MIN(timestamp)                                                         AS first_seen_ts,
      MAX(timestamp)                                                         AS last_seen_ts,
      MIN(block_number)                                                      AS first_seen_block,
      MAX(block_number)                                                      AS last_seen_block
    FROM events
    WHERE seller_address IS NOT NULL
      AND event_type IN (${CHANNEL_EVENT_TYPES_SQL})
    GROUP BY seller_address
    ORDER BY ${rawSqlFragment(orderExpr, allowedOrderExprs, "seller order clause")}
    LIMIT ${rawPositiveInteger(limit, "seller limit")}
    OFFSET ${rawNonNegativeInteger(offset, "seller offset")}
  `);
  return r.rows.map(shapeSellerRow);
}

export async function countSellers(): Promise<number> {
  const r = await db.execute<{ n: number }>(sql`
    SELECT COUNT(DISTINCT seller_address)::int AS n
    FROM events
    WHERE seller_address IS NOT NULL
      AND event_type IN (${CHANNEL_EVENT_TYPES_SQL})
  `);
  return Number(r.rows[0]?.n ?? 0);
}

async function getSellerUncached(address: string): Promise<SellerRow | null> {
  if (!isExplorerAddress(address)) return null;
  const r = await db.execute<any>(sql`
    SELECT
      seller_address                                                         AS address,
      COUNT(DISTINCT buyer_address)::int                                     AS unique_buyers,
      COUNT(*) FILTER (WHERE event_type = 'settled')::int                    AS total_sessions,
      COALESCE(SUM(delta_usdc) FILTER (WHERE event_type = 'settled'), 0)::float AS total_earned_usdc,
      COUNT(*) FILTER (
        WHERE event_type = 'closed'
          AND COALESCE(settled_amount_usdc,0) = 0
          AND NOT EXISTS (
            SELECT 1 FROM events s WHERE s.channel_id = events.channel_id AND s.event_type='settled'
          )
      )::int AS ghost_sessions,
      MIN(timestamp)                                                         AS first_seen_ts,
      MAX(timestamp)                                                         AS last_seen_ts,
      MIN(block_number)                                                      AS first_seen_block,
      MAX(block_number)                                                      AS last_seen_block
    FROM events
    WHERE seller_address = ${address.toLowerCase()}
      AND event_type IN (${CHANNEL_EVENT_TYPES_SQL})
    GROUP BY seller_address
  `);
  const row = r.rows[0];
  if (!row || row.address == null) return null;
  return shapeSellerRow(row);
}

export const getSeller = cache(getSellerUncached);

export async function getSellerDailyVolume(address: string, days = 30) {
  if (!isExplorerAddress(address)) return [];
  const d = cleanPositiveInt(days, 30, 10_000);
  const rows = await db.execute<{
    bucket: string;
    sessions: number;
    volume: number;
  }>(sql`
    SELECT to_char(to_timestamp(timestamp), 'YYYY-MM-DD') AS bucket,
           COUNT(*)::int AS sessions,
           COALESCE(SUM(delta_usdc),0)::float AS volume
    FROM events
    WHERE seller_address = ${address.toLowerCase()}
      AND event_type = 'settled'
      AND timestamp IS NOT NULL AND timestamp > 0 AND timestamp < 32503680000
      AND timestamp > extract(epoch from now())::bigint - ${rawPositiveInteger(d, "seller daily window days")} * 86400
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  return rows.rows;
}

export async function getSellerHourlyVolume(address: string, hours = 24) {
  if (!isExplorerAddress(address)) return [];
  const h = cleanPositiveInt(hours, 24, 24 * 365);
  const rows = await db.execute<{
    bucket: string;
    sessions: number;
    volume: number;
  }>(sql`
    SELECT to_char(to_timestamp(timestamp), 'YYYY-MM-DD HH24:00') AS bucket,
           COUNT(*)::int AS sessions,
           COALESCE(SUM(delta_usdc),0)::float AS volume
    FROM events
    WHERE seller_address = ${address.toLowerCase()}
      AND event_type = 'settled'
      AND timestamp IS NOT NULL
      AND timestamp > extract(epoch from now())::bigint - ${rawPositiveInteger(h, "seller hourly window hours")} * 3600
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  return rows.rows;
}

export async function getSellerBuyerSummary(
  address: string,
  limit = 10,
): Promise<{ buyer_address: string; sessions: number; total_usdc: number }[]> {
  if (!isExplorerAddress(address)) return [];
  const safeLimit = cleanPositiveInt(limit, 10, 100);
  const rows = await db.execute<{
    buyer_address: string;
    sessions: number;
    total_usdc: number;
  }>(sql`
    SELECT buyer_address,
           COUNT(*)::int AS sessions,
           COALESCE(SUM(delta_usdc),0)::float AS total_usdc
    FROM events
    WHERE seller_address = ${address.toLowerCase()}
      AND event_type = 'settled'
    GROUP BY buyer_address
    ORDER BY total_usdc DESC
    LIMIT ${rawPositiveInteger(safeLimit, "seller buyer summary limit")}
  `);
  return rows.rows;
}

// ---------------------------------------------------------------------------
// getHourlyVolume
// ---------------------------------------------------------------------------

export async function getHourlyVolume(hours = 24): Promise<
  { day: string; sessions: number; volume: number; active_buyers: number }[]
> {
  const h = cleanPositiveInt(hours, 24, 24 * 365);
  const rows = await db.execute<{
    day: string;
    sessions: number;
    volume: number;
    active_buyers: number;
  }>(sql`
    SELECT to_char(to_timestamp(timestamp), 'YYYY-MM-DD HH24:00') AS day,
           COUNT(*)::int AS sessions,
           COALESCE(SUM(delta_usdc),0)::float AS volume,
           COUNT(DISTINCT buyer_address)::int AS active_buyers
    FROM events
    WHERE event_type='settled'
      AND timestamp IS NOT NULL
      AND timestamp > extract(epoch from now())::bigint - ${rawPositiveInteger(h, "hourly volume window hours")} * 3600
    GROUP BY day
    ORDER BY day ASC
  `);
  return rows.rows;
}

// ---------------------------------------------------------------------------
// RecentEventRow + getRecentEvents
// ---------------------------------------------------------------------------

export interface RecentEventRow {
  tx_hash: string;
  log_index: number;
  block_number: number;
  event_type: string;
  buyer_address: string | null;
  seller_address: string | null;
  channel_id: string | null;
  delta_usdc: number | null;
  settled_amount_usdc: number | null;
  timestamp: number | null;
}

export async function getRecentEvents(limit = 20): Promise<RecentEventRow[]> {
  const safeLimit = cleanPositiveInt(limit, 20, 100);
  const r = await db.execute<any>(sql`
    SELECT tx_hash, log_index, block_number, event_type, buyer_address, seller_address,
           channel_id, delta_usdc, settled_amount_usdc, timestamp
    FROM events
    ORDER BY block_number DESC, log_index DESC
    LIMIT ${rawPositiveInteger(safeLimit, "recent events limit")}
  `);
  return r.rows.map((e: any) => ({
    tx_hash: e.tx_hash,
    log_index: Number(e.log_index),
    block_number: Number(e.block_number),
    event_type: e.event_type,
    buyer_address: e.buyer_address,
    seller_address: e.seller_address,
    channel_id: e.channel_id,
    delta_usdc: e.delta_usdc != null ? Number(e.delta_usdc) : null,
    settled_amount_usdc: e.settled_amount_usdc != null ? Number(e.settled_amount_usdc) : null,
    timestamp: e.timestamp != null ? Number(e.timestamp) : null,
  }));
}

// ---------------------------------------------------------------------------
// ChannelRow + channel queries
// ---------------------------------------------------------------------------

export interface ChannelRow {
  channel_id: string;
  buyer_address: string | null;
  seller_address: string | null;
  opened_block: number | null;
  last_block: number | null;
  opened_ts: number | null;
  last_ts: number | null;
  max_amount_usdc: number | null;
  settled_amount_usdc: number | null;
  total_delta_usdc: number | null;
  event_count: number;
  state: "Open" | "Settled" | "Created";
}

function shapeChannelRow(row: any): ChannelRow {
  const state: ChannelRow["state"] =
    row.closed ? "Settled" : row.reserved ? "Open" : "Created";
  return {
    channel_id: row.channel_id,
    buyer_address: row.buyer_address ?? null,
    seller_address: row.seller_address ?? null,
    opened_block: row.opened_block != null ? Number(row.opened_block) : null,
    last_block: row.last_block != null ? Number(row.last_block) : null,
    opened_ts: row.opened_ts != null ? Number(row.opened_ts) : null,
    last_ts: row.last_ts != null ? Number(row.last_ts) : null,
    max_amount_usdc: row.max_amount_usdc != null ? Number(row.max_amount_usdc) : null,
    settled_amount_usdc: row.settled_amount_usdc != null ? Number(row.settled_amount_usdc) : null,
    total_delta_usdc: row.total_delta_usdc != null ? Number(row.total_delta_usdc) : null,
    event_count: Number(row.event_count ?? 0),
    state,
  };
}

export async function listChannels(opts: {
  limit?: number;
  offset?: number;
  sort?: ChannelSort;
  dir?: "asc" | "desc";
} = {}): Promise<ChannelRow[]> {
  const limit = cleanPositiveInt(opts.limit, 25, 100);
  const offset = cleanNonNegativeInt(opts.offset);
  const sortColMap: Record<ChannelSort, string> = {
    amount: "max_amount_usdc",
    settled: "settled_amount_usdc",
    events: "event_count",
    opened: "opened_ts",
    last_activity: "last_ts",
  };
  const sortCol = sortColMap[opts.sort ?? CHANNEL_DEFAULT_SORT] ?? sortColMap[CHANNEL_DEFAULT_SORT];
  const dir = cleanDirection(opts.dir, "desc");
  const orderExpr = `${sortCol} ${dir.toUpperCase()}`;
  const allowedOrderExprs = Object.values(sortColMap).flatMap((col) => [
    `${col} ASC`,
    `${col} DESC`,
  ]);

  const r = await db.execute<any>(sql`
    SELECT
      channel_id,
      MIN(buyer_address)            AS buyer_address,
      MIN(seller_address)           AS seller_address,
      MIN(block_number)             AS opened_block,
      MAX(block_number)             AS last_block,
      MIN(timestamp)                AS opened_ts,
      MAX(timestamp)                AS last_ts,
      MAX(max_amount_usdc)          AS max_amount_usdc,
      MAX(settled_amount_usdc)      AS settled_amount_usdc,
      COALESCE(SUM(delta_usdc), 0)  AS total_delta_usdc,
      bool_or(event_type = 'closed')   AS closed,
      bool_or(event_type = 'reserved') AS reserved,
      COUNT(*)::int                 AS event_count
    FROM events
    WHERE channel_id IS NOT NULL
      AND event_type IN (${CHANNEL_EVENT_TYPES_SQL})
    GROUP BY channel_id
    ORDER BY ${rawSqlFragment(orderExpr, allowedOrderExprs, "channel order clause")}
    LIMIT ${rawPositiveInteger(limit, "channel limit")}
    OFFSET ${rawNonNegativeInteger(offset, "channel offset")}
  `);
  return r.rows.map(shapeChannelRow);
}

export async function countChannels(): Promise<number> {
  const r = await db.execute<{ n: number }>(sql`
    SELECT COUNT(DISTINCT channel_id)::int AS n
    FROM events
    WHERE channel_id IS NOT NULL
      AND event_type IN (${CHANNEL_EVENT_TYPES_SQL})
  `);
  return Number(r.rows[0]?.n ?? 0);
}

async function getChannelUncached(id: string): Promise<ChannelRow | null> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return null;
  const channelId = id.toLowerCase();
  const r = await db.execute<any>(sql`
    SELECT
      channel_id,
      MIN(buyer_address)            AS buyer_address,
      MIN(seller_address)           AS seller_address,
      MIN(block_number)             AS opened_block,
      MAX(block_number)             AS last_block,
      MIN(timestamp)                AS opened_ts,
      MAX(timestamp)                AS last_ts,
      MAX(max_amount_usdc)          AS max_amount_usdc,
      MAX(settled_amount_usdc)      AS settled_amount_usdc,
      COALESCE(SUM(delta_usdc), 0)  AS total_delta_usdc,
      bool_or(event_type = 'closed')   AS closed,
      bool_or(event_type = 'reserved') AS reserved,
      COUNT(*)::int                 AS event_count
    FROM events
    WHERE channel_id = ${channelId}
      AND event_type IN (${CHANNEL_EVENT_TYPES_SQL})
    GROUP BY channel_id
  `);
  const row = r.rows[0];
  if (!row || row.channel_id == null) return null;
  return shapeChannelRow(row);
}

export const getChannel = cache(getChannelUncached);

export async function getChannelEvents(
  channelId: string,
  limit = 100,
) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(channelId)) return [];
  const id = channelId.toLowerCase();
  const safeLimit = cleanPositiveInt(limit, 100, 200);
  const r = await db.execute<any>(sql`
    SELECT tx_hash, log_index, block_number, event_type, buyer_address, seller_address,
           channel_id, delta_usdc, settled_amount_usdc, input_tokens, output_tokens,
           request_count, timestamp
    FROM events
    WHERE channel_id = ${id}
      AND event_type IN (${CHANNEL_EVENT_TYPES_SQL})
    ORDER BY block_number ASC, log_index ASC
    LIMIT ${rawPositiveInteger(safeLimit, "channel events limit")}
  `);
  return r.rows.map((e: any) => ({
    tx_hash: e.tx_hash,
    log_index: e.log_index,
    block_number: e.block_number,
    event_type: e.event_type,
    buyer_address: e.buyer_address,
    seller_address: e.seller_address,
    channel_id: e.channel_id,
    delta_usdc: e.delta_usdc,
    settled_amount_usdc: e.settled_amount_usdc,
    input_tokens: e.input_tokens,
    output_tokens: e.output_tokens,
    request_count: e.request_count,
    timestamp: e.timestamp,
  }));
}

// ---------------------------------------------------------------------------
// ServiceRow + service queries
// ---------------------------------------------------------------------------

type ServicePricing = { inputUsdPerMillion?: number; outputUsdPerMillion?: number };

function servicePricingCost(pricing: ServicePricing | null): number {
  const input = pricing?.inputUsdPerMillion ?? Number.POSITIVE_INFINITY;
  const output = pricing?.outputUsdPerMillion ?? Number.POSITIVE_INFINITY;
  return input + output;
}

function isBetterServicePricing(
  candidate: ServicePricing | null,
  current: ServicePricing | null,
): boolean {
  const candidateCost = servicePricingCost(candidate);
  const currentCost = servicePricingCost(current);
  if (candidateCost !== currentCost) return candidateCost < currentCost;
  return current == null && candidate != null;
}

export interface ServiceRow {
  // The canonical key (e.g. "claude-opus-4-6"). Used as the URL slug for
  // /services/[name] so links survive raw-alias spelling changes upstream.
  name: string;
  display: string;
  aliases: string[];
  provider_count: number;
  providers: string[];
  min_price_in: number | null;
  max_price_in: number | null;
  min_price_out: number | null;
  max_price_out: number | null;
}

export interface ServiceProviderRow extends ServiceRow {
  provider_details: Array<{
    address: string;
    display_name: string | null;
    peer_id: string | null;
    pricing: ServicePricing | null;
    pricing_service: string | null;
    advertised_as: string[];
  }>;
}

type PricingMap = Record<string, ServicePricing>;

// Rolled-up service listing keyed by canonical model. Multiple raw service
// strings ("Claude Opus 4.6" / "claude-opus-4-6") collapse into one row;
// providers and prices are aggregated across all aliases.
export async function listServices(): Promise<ServiceRow[]> {
  const allProviders = (await db.execute<any>(sql`
    SELECT address, display_name, peer_id, services, pricing FROM provider_directory
  `)).rows;

  // canonical key -> rollup buckets
  type Bucket = {
    display: string;
    aliases: Set<string>;
    providers: Set<string>;
    pricesIn: number[];
    pricesOut: number[];
  };
  const byKey = new Map<string, Bucket>();

  for (const provider of allProviders) {
    const services = parseJson<string[]>(provider.services) ?? [];
    const pricing = parseJson<PricingMap>(provider.pricing) ?? {};
    for (const svc of services) {
      const { key, display } = canonicalize(svc);
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = {
          display,
          aliases: new Set(),
          providers: new Set(),
          pricesIn: [],
          pricesOut: [],
        };
        byKey.set(key, bucket);
      }
      bucket.aliases.add(svc);
      bucket.providers.add(provider.address);
      const svcPricing = pricing[svc];
      if (svcPricing?.inputUsdPerMillion != null) bucket.pricesIn.push(svcPricing.inputUsdPerMillion);
      if (svcPricing?.outputUsdPerMillion != null) bucket.pricesOut.push(svcPricing.outputUsdPerMillion);
    }
  }

  const result: ServiceRow[] = [];
  for (const [key, b] of byKey) {
    result.push({
      name: key,
      display: b.display,
      aliases: [...b.aliases].sort(),
      provider_count: b.providers.size,
      providers: [...b.providers],
      min_price_in: b.pricesIn.length > 0 ? Math.min(...b.pricesIn) : null,
      max_price_in: b.pricesIn.length > 0 ? Math.max(...b.pricesIn) : null,
      min_price_out: b.pricesOut.length > 0 ? Math.min(...b.pricesOut) : null,
      max_price_out: b.pricesOut.length > 0 ? Math.max(...b.pricesOut) : null,
    });
  }

  // Sort by provider_count desc, then display asc
  result.sort((a, b) =>
    b.provider_count !== a.provider_count
      ? b.provider_count - a.provider_count
      : a.display.localeCompare(b.display),
  );
  return result;
}

// Lookup a service by either canonical key or any raw alias.
// Returns aggregated providers across all aliases of the canonical model.
async function getServiceUncached(input: string): Promise<ServiceProviderRow | null> {
  const { key: canonicalKey, display: canonicalDisplay } = canonicalize(input);

  const allProviders = (await db.execute<any>(sql`
    SELECT address, display_name, peer_id, services, pricing FROM provider_directory
  `)).rows;

  // Dedup providers by address; collect every alias they advertise that maps
  // to this canonical model so the detail page can show what they list it as.
  type Detail = {
    address: string;
    display_name: string | null;
    peer_id: string | null;
    pricing: ServicePricing | null;
    pricing_service: string | null;
    advertised_as: string[];
  };
  const byAddress = new Map<string, Detail>();
  const aliasesSeen = new Set<string>();
  const pricesIn: number[] = [];
  const pricesOut: number[] = [];

  for (const provider of allProviders) {
    const services = parseJson<string[]>(provider.services) ?? [];
    const pricing = parseJson<PricingMap>(provider.pricing) ?? {};
    for (const svc of services) {
      if (canonicalize(svc).key !== canonicalKey) continue;
      aliasesSeen.add(svc);
      const svcPricing = pricing[svc] ?? null;
      if (svcPricing?.inputUsdPerMillion != null) pricesIn.push(svcPricing.inputUsdPerMillion);
      if (svcPricing?.outputUsdPerMillion != null) pricesOut.push(svcPricing.outputUsdPerMillion);

      const existing = byAddress.get(provider.address);
      if (existing) {
        existing.advertised_as.push(svc);
        // Keep the cheapest price seen for this provider's display row and
        // remember the raw advertised service that owns that pricing entry.
        if (isBetterServicePricing(svcPricing, existing.pricing)) {
          existing.pricing = svcPricing;
          existing.pricing_service = svc;
        }
      } else {
        byAddress.set(provider.address, {
          address: provider.address,
          display_name: provider.display_name ?? null,
          peer_id: provider.peer_id ?? null,
          pricing: svcPricing,
          pricing_service: svc,
          advertised_as: [svc],
        });
      }
    }
  }

  if (byAddress.size === 0) return null;

  return {
    name: canonicalKey,
    display: canonicalDisplay,
    aliases: [...aliasesSeen].sort(),
    provider_count: byAddress.size,
    providers: [...byAddress.keys()],
    min_price_in: pricesIn.length > 0 ? Math.min(...pricesIn) : null,
    max_price_in: pricesIn.length > 0 ? Math.max(...pricesIn) : null,
    min_price_out: pricesOut.length > 0 ? Math.min(...pricesOut) : null,
    max_price_out: pricesOut.length > 0 ? Math.max(...pricesOut) : null,
    provider_details: [...byAddress.values()],
  };
}

export const getService = cache(getServiceUncached);

// ---------------------------------------------------------------------------
// Flat (service, provider) listing for the marketplace UX
// ---------------------------------------------------------------------------

export interface ServiceFlatRow {
  service_name: string;
  provider_address: string;
  display_name: string | null;
  input_price: number | null;
  output_price: number | null;
  region: string | null;
  trust_score: number | null;
  updated_at: number | null;
}

export async function listServicesFlat(): Promise<ServiceFlatRow[]> {
  const allProviders = (await db.execute<any>(sql`
    SELECT address, display_name, services, pricing, region, trust_score, updated_at
    FROM provider_directory
    ORDER BY address
    LIMIT 5000
  `)).rows;

  const result: ServiceFlatRow[] = [];
  const seen = new Set<string>();
  for (const provider of allProviders) {
    const services = parseJson<string[]>(provider.services) ?? [];
    const pricing = parseJson<PricingMap>(provider.pricing) ?? {};
    for (const svc of services) {
      const key = `${svc}|${provider.address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const svcPricing = pricing[svc];
      result.push({
        service_name: svc,
        provider_address: provider.address,
        display_name: provider.display_name ?? null,
        input_price: svcPricing?.inputUsdPerMillion ?? null,
        output_price: svcPricing?.outputUsdPerMillion ?? null,
        region: provider.region ?? null,
        trust_score: provider.trust_score != null ? Number(provider.trust_score) : null,
        updated_at: provider.updated_at != null ? Number(provider.updated_at) : null,
      });
    }
  }

  result.sort((a, b) => {
    const byName = a.service_name.localeCompare(b.service_name);
    if (byName !== 0) return byName;
    const ai = a.input_price;
    const bi = b.input_price;
    if (ai == null && bi == null) return 0;
    if (ai == null) return 1;
    if (bi == null) return -1;
    return ai - bi;
  });

  return result;
}

// ---------------------------------------------------------------------------
// Search helpers — service name and provider display_name lookups
// ---------------------------------------------------------------------------

export async function lookupByServiceName(q: string): Promise<string | null> {
  const rows = await db.execute<{ services: string | null }>(sql`
    SELECT services FROM provider_directory
    WHERE services IS NOT NULL
    LIMIT 200
  `);
  const needle = q.toLowerCase();
  for (const row of rows.rows) {
    if (!row.services) continue;
    try {
      const list: string[] = JSON.parse(row.services);
      const match = list.find((s) => s.toLowerCase() === needle);
      if (match) return match;
    } catch {}
  }
  return null;
}

export async function lookupByProviderName(
  q: string,
): Promise<string | null> {
  const rows = await db.execute<{ address: string }>(sql`
    SELECT address FROM provider_directory
    WHERE lower(display_name) = ${q.toLowerCase()}
    LIMIT 1
  `);
  return rows.rows[0]?.address ?? null;
}

export interface AddressPrefixMatchRow extends Record<string, unknown> {
  address: string;
}

function cleanAddressPrefix(prefix: string): string | null {
  const normalized = prefix.toLowerCase();
  return ADDRESS_PREFIX_RE.test(normalized) ? normalized : null;
}

export async function searchBuyersByPrefix(
  prefix: string,
  limit = 8,
): Promise<AddressPrefixMatchRow[]> {
  const normalized = cleanAddressPrefix(prefix);
  if (!normalized) return [];
  const safeLimit = cleanPositiveInt(limit, 8, 20);
  const rows = await db.execute<AddressPrefixMatchRow>(sql`
    SELECT address
    FROM buyer_profiles
    WHERE address LIKE ${`${normalized}%`}
    ORDER BY trust_score DESC, address ASC
    LIMIT ${rawPositiveInteger(safeLimit, "buyer prefix limit")}
  `);
  return rows.rows;
}

export async function searchSellersByPrefix(
  prefix: string,
  limit = 8,
): Promise<AddressPrefixMatchRow[]> {
  const normalized = cleanAddressPrefix(prefix);
  if (!normalized) return [];
  const safeLimit = cleanPositiveInt(limit, 8, 20);
  const rows = await db.execute<AddressPrefixMatchRow>(sql`
    SELECT address
    FROM provider_directory
    WHERE address LIKE ${`${normalized}%`}
    ORDER BY trust_score DESC NULLS LAST, updated_at DESC NULLS LAST, address ASC
    LIMIT ${rawPositiveInteger(safeLimit, "seller prefix limit")}
  `);
  return rows.rows;
}

// ---------------------------------------------------------------------------
// Provider directory — full listing with on-chain aggregates
// ---------------------------------------------------------------------------

export interface DirectoryProviderRow {
  address: string;
  displayName: string | null;
  region: string | null;
  services: string[];
  pricing: Record<string, { inputUsdPerMillion?: number; outputUsdPerMillion?: number }>;
  sessionCount: number;
  totalVolumeUsdc: number;
  ghostCount: number;
  closedCount: number;
  updatedAt: number | null;
  // First on-chain settlement timestamp for this seller. Closest available
  // proxy for "joined" — provider_directory has no registration_at column.
  firstSettledTs: number | null;
  lastSettledTs: number | null;
  // Upstream-synced score from network.antseed.com (currently always null —
  // the /stats endpoint doesn't expose it). We compute reputation locally
  // via lib/reputation.ts using events-table aggregates.
  trustScore: number | null;
  // Non-null when `address` is a seller delegation contract; the operator
  // EVM address derived from the libp2p peerId.
  operatorAddress: string | null;
}

export type ProviderSortKey = ProviderSort;

interface ProviderListOptions {
  sort?: ProviderSortKey;
  // Raw service strings to match against pd.services (JSON-text array).
  // Pass an array (not a canonical key) so callers can expand a canonical
  // group into all of its aliases before querying.
  serviceAliases?: string[];
  active7d?: boolean;
  limit?: number;
  offset?: number;
  address?: string;
}

function providerWhereClause(opts: ProviderListOptions) {
  const filters = [sql`1=1`];
  if (opts.address) {
    if (!/^0x[0-9a-f]{40}$/.test(opts.address)) return sql`1=0`;
    filters.push(sql`pd.address = ${opts.address}`);
  }
  if (opts.serviceAliases && opts.serviceAliases.length > 0) {
    // services is stored as a JSON text array, e.g. '["llm.chat.gpt-4o","..."]'
    const aliasClauses = opts.serviceAliases
      .filter((a) => typeof a === "string" && a.length > 0)
      .slice(0, 100)
      .map((a) => sql`pd.services LIKE ${`%"${a.slice(0, 120)}"%`}`);
    if (aliasClauses.length > 0) {
      filters.push(sql`(${sql.join(aliasClauses, sql` OR `)})`);
    }
  }
  if (opts.active7d) {
    // Provider has >=1 settled event in last 7 days.
    filters.push(
      sql`agg.last_settled_ts >= EXTRACT(EPOCH FROM NOW()) - 604800`,
    );
  }
  return sql.join(filters, sql` AND `);
}

export async function listProviders(opts: ProviderListOptions = {}): Promise<DirectoryProviderRow[]> {
  // Reputation is computed in JS post-fetch (see lib/reputation.ts), so the
  // SQL sort uses a coarse proxy that puts revenue-active sellers first.
  // Fine ordering is then applied in app/providers/page.tsx.
  const sortColMap: Record<ProviderSortKey, string> = {
    volume: "COALESCE(agg.total_volume, 0) DESC",
    score: "COALESCE(agg.total_volume, 0) DESC",
    sessions: "COALESCE(agg.session_count, 0) DESC",
    ghost: "CASE WHEN COALESCE(agg.closed_count,0)>0 THEN COALESCE(agg.ghost_count,0)::float/agg.closed_count ELSE 0 END DESC",
    joined: "agg.first_settled_ts ASC NULLS LAST",
    reputation: "COALESCE(agg.total_volume, 0) DESC",
    recent: "pd.updated_at DESC NULLS LAST",
  };
  const orderExpr = sortColMap[opts.sort ?? PROVIDER_DEFAULT_SORT] ?? sortColMap[PROVIDER_DEFAULT_SORT];
  const allowedOrderExprs = Object.values(sortColMap);

  const whereClause = providerWhereClause(opts);
  const limit = opts.limit == null ? null : cleanPositiveInt(opts.limit, 100, 1000);
  const offset = opts.offset == null ? null : cleanNonNegativeInt(opts.offset);

  const rows = (await db.execute<any>(sql`
    SELECT
      pd.address,
      pd.display_name,
      pd.region,
      pd.services,
      pd.pricing,
      pd.operator_address,
      pd.trust_score,
      pd.updated_at,
      COALESCE(agg.session_count, 0)::int   AS session_count,
      COALESCE(agg.total_volume, 0)::float  AS total_volume,
      COALESCE(agg.ghost_count, 0)::int     AS ghost_count,
      COALESCE(agg.closed_count, 0)::int    AS closed_count,
      agg.first_settled_ts,
      agg.last_settled_ts
    FROM provider_directory pd
    LEFT JOIN (
      SELECT
        seller_address,
        COUNT(DISTINCT CASE WHEN event_type='settled' THEN channel_id END)::int      AS session_count,
        COALESCE(SUM(CASE WHEN event_type='settled' THEN delta_usdc ELSE 0 END),0)::float AS total_volume,
        COUNT(DISTINCT CASE
          WHEN event_type='closed'
            AND COALESCE(settled_amount_usdc,0)=0
            AND NOT EXISTS (
              SELECT 1 FROM events s WHERE s.channel_id = events.channel_id AND s.event_type='settled'
            )
          THEN channel_id
        END)::int AS ghost_count,
        COUNT(DISTINCT CASE WHEN event_type='closed' THEN channel_id END)::int       AS closed_count,
        MIN(timestamp) FILTER (WHERE event_type='settled')::bigint                  AS first_settled_ts,
        MAX(timestamp) FILTER (WHERE event_type='settled')::bigint                  AS last_settled_ts
      FROM events
      WHERE seller_address IS NOT NULL
      GROUP BY seller_address
    ) agg ON agg.seller_address = pd.address
    WHERE ${whereClause}
    ORDER BY ${rawSqlFragment(orderExpr, allowedOrderExprs, "provider order clause")}
    ${limit == null ? sql`` : sql`LIMIT ${rawPositiveInteger(limit, "provider limit")}`}
    ${offset == null ? sql`` : sql`OFFSET ${rawNonNegativeInteger(offset, "provider offset")}`}
  `)).rows;

  return rows.map((r: any) => ({
    address: r.address,
    displayName: r.display_name ?? null,
    region: r.region ?? null,
    services: parseJson<string[]>(r.services) ?? [],
    pricing: parseJson<DirectoryProviderRow["pricing"]>(r.pricing) ?? {},
    sessionCount: Number(r.session_count ?? 0),
    totalVolumeUsdc: Number(r.total_volume ?? 0),
    ghostCount: Number(r.ghost_count ?? 0),
    closedCount: Number(r.closed_count ?? 0),
    updatedAt: r.updated_at != null ? Number(r.updated_at) : null,
    firstSettledTs: r.first_settled_ts != null ? Number(r.first_settled_ts) : null,
    lastSettledTs: r.last_settled_ts != null ? Number(r.last_settled_ts) : null,
    trustScore: r.trust_score != null ? Number(r.trust_score) : null,
    operatorAddress: r.operator_address ?? null,
  }));
}

export async function countProviders(opts: ProviderListOptions = {}): Promise<number> {
  const whereClause = providerWhereClause(opts);
  const rows = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM provider_directory pd
    LEFT JOIN (
      SELECT
        seller_address,
        MAX(timestamp) FILTER (WHERE event_type='settled')::bigint AS last_settled_ts
      FROM events
      WHERE seller_address IS NOT NULL
      GROUP BY seller_address
    ) agg ON agg.seller_address = pd.address
    WHERE ${whereClause}
  `);
  return Number(rows.rows[0]?.n ?? 0);
}

export interface ProviderCatalogRow {
  address: string;
  displayName: string | null;
  region: string | null;
  services: string[];
  pricing: DirectoryProviderRow["pricing"];
  updatedAt: number | null;
}

export async function getProviderCatalog(address: string): Promise<ProviderCatalogRow | null> {
  if (!isExplorerAddress(address)) return null;
  const row = await lookupProvider(address);
  if (!row) return null;
  return {
    address: row.address,
    displayName: row.display_name ?? null,
    region: row.region ?? null,
    services: row.services,
    pricing: row.pricing,
    updatedAt: row.updated_at,
  };
}

// Facet values + counts for the /providers filter bar. Service strings are
// grouped into canonical buckets (lib/services-canonical.ts) so the dropdown
// doesn't list "Claude Opus 4.6", "claude-opus-4.6", and "claude-opus-4-6"
// as three separate rows. Raw aliases are preserved on each group so the
// filter query can expand a canonical pick into all matching raw strings.
export async function listProviderFacets(): Promise<{
  serviceGroups: ServiceGroup[];
  totalCount: number;
  activeCount: number;
}> {
  const [facetRows, countRows] = await Promise.all([
    db.execute<{ services: string | null }>(sql`
      SELECT services FROM provider_directory
    `),
    db.execute<{ total: number; active7d: number }>(sql`
      SELECT
        (SELECT COUNT(*)::int FROM provider_directory) AS total,
        (SELECT COUNT(DISTINCT e.seller_address)::int
           FROM events e
           INNER JOIN provider_directory pd ON pd.address = e.seller_address
           WHERE e.event_type = 'settled'
             AND e.timestamp >= EXTRACT(EPOCH FROM NOW()) - 604800
        ) AS active7d
    `),
  ]);

  const all: string[] = [];
  for (const r of facetRows.rows) {
    const list = parseJson<string[]>(r.services) ?? [];
    for (const s of list) all.push(s);
  }
  const c = countRows.rows[0] ?? { total: 0, active7d: 0 };
  return {
    serviceGroups: groupServices(all),
    totalCount: Number(c.total ?? 0),
    activeCount: Number(c.active7d ?? 0),
  };
}

// ---------------------------------------------------------------------------
// $ANT holders — ranked listing for the /holders page.
// Excludes protocol contracts (ANTS_NON_USER_ADDRESSES) so the totals match
// what the Paying Users hero card surfaces. %supply is computed against the
// indexed circulating total (sum of positive non-protocol balances), not
// against max supply — gives a useful share-of-active-supply signal as the
// network grows.
// ---------------------------------------------------------------------------

export interface HolderRow {
  address: string;
  kind: "buyer" | "seller" | "none";
  balance_wei: string;
  balance_ants: number;
  staked_balance_wei: string;
  staked_balance_ants: number;
  pct_supply: number;
  first_seen_block: number | null;
  last_seen_block: number | null;
  updated_at: number | null;
}

export async function listHolders(opts: {
  limit?: number;
  offset?: number;
} = {}): Promise<HolderRow[]> {
  const limit = cleanPositiveInt(opts.limit, 50, 200);
  const offset = cleanNonNegativeInt(opts.offset);
  const { ANTS_NON_USER_ADDRESSES } = await import("./antseed");
  const excludeSql = rawAddressList(ANTS_NON_USER_ADDRESSES, "non-user ANTS addresses");

  const r = await db.execute<any>(sql`
    WITH circulating AS (
      SELECT COALESCE(SUM(balance + staked_balance), 0) AS total
      FROM ants_holders
      WHERE balance + staked_balance > 0
        AND address NOT IN (${excludeSql})
    ),
    holder_page AS (
      SELECT
        address,
        balance + staked_balance                 AS total_balance,
        balance::text                            AS balance_wei,
        (balance / 1e18)::float                  AS balance_ants,
        staked_balance::text                     AS staked_balance_wei,
        (staked_balance / 1e18)::float           AS staked_balance_ants,
        CASE
          WHEN (SELECT total FROM circulating) > 0
          THEN ((balance + staked_balance) * 100.0 / (SELECT total FROM circulating))::float
          ELSE 0
        END                                       AS pct_supply,
        first_seen_block,
        last_seen_block,
        updated_at
      FROM ants_holders
      WHERE balance + staked_balance > 0
        AND address NOT IN (${excludeSql})
      ORDER BY (balance + staked_balance) DESC
      LIMIT ${rawPositiveInteger(limit, "holders limit")}
      OFFSET ${rawNonNegativeInteger(offset, "holders offset")}
    ),
    seller_matches AS (
      SELECT pd.address
      FROM provider_directory pd
      INNER JOIN holder_page hp ON hp.address = pd.address
      UNION
      SELECT DISTINCT e.seller_address AS address
      FROM events e
      INNER JOIN holder_page hp ON hp.address = e.seller_address
      WHERE e.seller_address IS NOT NULL
        AND e.event_type IN (${CHANNEL_EVENT_TYPES_SQL})
    )
    SELECT
      hp.address,
      CASE
        WHEN bp.address IS NOT NULL THEN 'buyer'
        WHEN sm.address IS NOT NULL THEN 'seller'
        ELSE 'none'
      END                                       AS kind,
      hp.balance_wei,
      hp.balance_ants,
      hp.staked_balance_wei,
      hp.staked_balance_ants,
      hp.pct_supply,
      hp.first_seen_block,
      hp.last_seen_block,
      hp.updated_at
    FROM holder_page hp
    LEFT JOIN buyer_profiles bp ON bp.address = hp.address
    LEFT JOIN seller_matches sm ON sm.address = hp.address
    ORDER BY hp.total_balance DESC
  `);

  return r.rows.map((x: any) => ({
    address: x.address,
    kind: x.kind === "buyer" || x.kind === "seller" ? x.kind : "none",
    balance_wei: String(x.balance_wei ?? "0"),
    balance_ants: Number(x.balance_ants ?? 0),
    staked_balance_wei: String(x.staked_balance_wei ?? "0"),
    staked_balance_ants: Number(x.staked_balance_ants ?? 0),
    pct_supply: Number(x.pct_supply ?? 0),
    first_seen_block:
      x.first_seen_block != null ? Number(x.first_seen_block) : null,
    last_seen_block:
      x.last_seen_block != null ? Number(x.last_seen_block) : null,
    updated_at: x.updated_at != null ? Number(x.updated_at) : null,
  }));
}

export async function countHolders(): Promise<number> {
  const { ANTS_NON_USER_ADDRESSES } = await import("./antseed");
  const excludeSql = rawAddressList(ANTS_NON_USER_ADDRESSES, "non-user ANTS addresses");
  const r = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM ants_holders
    WHERE balance + staked_balance > 0
      AND address NOT IN (${excludeSql})
  `);
  return Number(r.rows[0]?.n ?? 0);
}

export interface AntsOverview {
  maxSupplyAnts: number;
  mintedAnts: number;
  availableAnts: number;
  claimedAnts: number;
  claimedAccounts: number;
  lockedAnts: number;
  unclaimedAnts: number;
  treasuryUsdc: number;
}

async function computeAntsOverview(): Promise<AntsOverview> {
  const maxSupplyAnts = 1_040_000_000;
  const rows = await db.execute<{
    claimed_ants: number | string | null;
    claimed_accounts: number;
    locked_ants: number | string | null;
    treasury_usdc: number;
  }>(sql`
    WITH claims AS (
      SELECT
        COALESCE(SUM(((raw_log::jsonb -> 'args' ->> 'amount')::numeric / 1e18)), 0)::float AS claimed_ants,
        COUNT(DISTINCT buyer_address)::int AS claimed_accounts
      FROM events
      WHERE event_type = 'ants_claim'
        AND raw_log IS NOT NULL
        AND raw_log::jsonb -> 'args' ->> 'amount' IS NOT NULL
    ),
    locked AS (
      SELECT COALESCE(SUM(staked_balance / 1e18), 0)::float AS locked_ants
      FROM ants_holders
      WHERE staked_balance > 0
    ),
    treasury AS (
      SELECT COALESCE(SUM(platform_fee_usdc), 0)::float AS treasury_usdc
      FROM events
      WHERE event_type = 'settled'
    )
    SELECT
      claims.claimed_ants,
      claims.claimed_accounts,
      locked.locked_ants,
      treasury.treasury_usdc
    FROM claims, locked, treasury
  `);
  const row = rows.rows[0];
  const claimedAnts = Number(row?.claimed_ants ?? 0);
  const lockedAnts = Number(row?.locked_ants ?? 0);
  return {
    maxSupplyAnts,
    mintedAnts: claimedAnts,
    availableAnts: Math.max(0, maxSupplyAnts - claimedAnts),
    claimedAnts,
    claimedAccounts: Number(row?.claimed_accounts ?? 0),
    lockedAnts,
    unclaimedAnts: Math.max(0, maxSupplyAnts - claimedAnts),
    treasuryUsdc: Number(row?.treasury_usdc ?? 0),
  };
}

export const getAntsOverview = createTtlCache(
  computeAntsOverview,
  HOT_PAGE_AGGREGATE_CACHE_TTL_MS,
).get;
