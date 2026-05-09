import { db } from "./db";
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
  sort?: "score" | "volume" | "sessions" | "first_seen";
} = {}): Promise<BuyerRow[]> {
  const limit = opts.limit ?? 25;
  const offset = opts.offset ?? 0;
  const minScore = opts.minScore ?? 0;

  const conditions = [gte(buyerProfiles.trustScore, minScore)];
  if (opts.qualifiedOnly) conditions.push(eq(buyerProfiles.qualified, true));

  const orderBy =
    opts.sort === "volume"
      ? desc(buyerProfiles.totalSettledUsdc)
      : opts.sort === "sessions"
        ? desc(buyerProfiles.totalSessions)
        : opts.sort === "first_seen"
          ? asc(buyerProfiles.firstSeenBlock)
          : desc(buyerProfiles.trustScore);

  const rows = await db
    .select()
    .from(buyerProfiles)
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);
  return rows.map(shapeBuyer);
}

export async function countBuyers(opts: {
  qualifiedOnly?: boolean;
  minScore?: number;
} = {}): Promise<number> {
  const minScore = opts.minScore ?? 0;
  const conditions = [gte(buyerProfiles.trustScore, minScore)];
  if (opts.qualifiedOnly) conditions.push(eq(buyerProfiles.qualified, true));
  const r = await db
    .select({ n: count() })
    .from(buyerProfiles)
    .where(and(...conditions));
  return r[0]?.n ?? 0;
}

export async function getBuyer(address: string): Promise<BuyerRow | null> {
  const rows = await db
    .select()
    .from(buyerProfiles)
    .where(eq(buyerProfiles.address, address.toLowerCase()))
    .limit(1);
  return rows[0] ? shapeBuyer(rows[0]) : null;
}

export async function getBuyerSessions(address: string, limit = 25) {
  const rows = await db
    .select()
    .from(eventsTbl)
    .where(eq(eventsTbl.buyerAddress, address.toLowerCase()))
    .orderBy(desc(eventsTbl.blockNumber), desc(eventsTbl.logIndex))
    .limit(limit);
  // Re-shape to snake_case keys for the existing UI.
  return rows.map((e) => ({
    tx_hash: e.txHash,
    log_index: e.logIndex,
    block_number: e.blockNumber,
    event_type: e.eventType,
    buyer_address: e.buyerAddress,
    seller_address: e.sellerAddress,
    channel_id: e.channelId,
    delta_usdc: e.deltaUsdc,
    settled_amount_usdc: e.settledAmountUsdc,
    input_tokens: e.inputTokens,
    output_tokens: e.outputTokens,
    request_count: e.requestCount,
    timestamp: e.timestamp,
  }));
}

export async function getBuyerMonthlyVolume(address: string) {
  const rows = await db.execute<{
    month: string;
    sessions: number;
    volume: number;
  }>(sql`
    SELECT to_char(to_timestamp(timestamp), 'YYYY-MM') AS month,
           COUNT(*)::int AS sessions,
           COALESCE(SUM(delta_usdc),0)::float AS volume
    FROM events
    WHERE buyer_address = ${address.toLowerCase()}
      AND event_type = 'settled'
      AND timestamp IS NOT NULL AND timestamp > 0
    GROUP BY month
    ORDER BY month ASC
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
    LIMIT ${limit}
  `);
  // bigint -> number for JSON friendliness in the UI
  return rows.rows.map((r: any) => ({
    ...r,
    total_input_tokens: Number(r.total_input_tokens),
    total_output_tokens: Number(r.total_output_tokens),
  }));
}

export async function getNetworkStats() {
  const [b, agg, qual, lastBlock, lastSync, lastHead] = await Promise.all([
    db.select({ n: count() }).from(buyerProfiles),
    db
      .select({
        volume: sql<number>`coalesce(sum(${buyerProfiles.totalSettledUsdc}),0)::float as volume`,
        sessions: sql<number>`coalesce(sum(${buyerProfiles.totalSessions}),0)::int as sessions`,
        ghosts: sql<number>`coalesce(sum(${buyerProfiles.ghostSessions}),0)::int as ghosts`,
      })
      .from(buyerProfiles),
    db
      .select({ n: count() })
      .from(buyerProfiles)
      .where(eq(buyerProfiles.qualified, true)),
    db
      .select({ value: indexerState.value })
      .from(indexerState)
      .where(eq(indexerState.key, "last_indexed_block"))
      .limit(1),
    db
      .select({ value: indexerState.value })
      .from(indexerState)
      .where(eq(indexerState.key, "last_sync_ts"))
      .limit(1),
    db
      .select({ value: indexerState.value })
      .from(indexerState)
      .where(eq(indexerState.key, "last_head_block"))
      .limit(1),
  ]);
  return {
    totalBuyers: b[0]?.n ?? 0,
    qualifiedBuyers: qual[0]?.n ?? 0,
    totalVolumeUsdc: agg[0]?.volume ?? 0,
    totalSessions: agg[0]?.sessions ?? 0,
    totalGhosts: agg[0]?.ghosts ?? 0,
    lastIndexedBlock: lastBlock[0] ? Number(lastBlock[0].value) : null,
    lastHeadBlock: lastHead[0] ? Number(lastHead[0].value) : null,
    lastSyncTs: lastSync[0] ? Number(lastSync[0].value) : null,
  };
}

export async function getDailyVolume(days = 30) {
  const rows = await db.execute<{
    day: string;
    sessions: number;
    volume: number;
    active_buyers: number;
  }>(sql`
    SELECT to_char(to_timestamp(timestamp), 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS sessions,
           COALESCE(SUM(delta_usdc),0)::float AS volume,
           COUNT(DISTINCT buyer_address)::int AS active_buyers
    FROM events
    WHERE event_type='settled'
      AND timestamp IS NOT NULL
      AND timestamp > extract(epoch from now())::bigint - ${days} * 86400
    GROUP BY day
    ORDER BY day ASC
  `);
  return rows.rows;
}

export async function getProfileDrift() {
  const rows = await db.execute<{ events_usdc: number; profiles_usdc: number }>(sql`
    SELECT
      (SELECT COALESCE(SUM(delta_usdc),0) FROM events WHERE event_type='settled')::float AS events_usdc,
      (SELECT COALESCE(SUM(total_settled_usdc),0) FROM buyer_profiles)::float AS profiles_usdc
  `);
  const r = rows.rows[0] || { events_usdc: 0, profiles_usdc: 0 };
  return {
    eventsUsdc: r.events_usdc,
    profilesUsdc: r.profiles_usdc,
    driftUsdc: +(r.events_usdc - r.profiles_usdc).toFixed(6),
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
}

export async function lookupProvider(
  address: string | null,
): Promise<ProviderRow | null> {
  if (!address) return null;
  const rows = await db
    .select()
    .from(providerDirectory)
    .where(eq(providerDirectory.address, address.toLowerCase()))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    address: r.address,
    display_name: r.displayName,
    peer_id: r.peerId,
    region: r.region,
    trust_score: r.trustScore,
    services: parseJson<string[]>(r.services) ?? [],
    pricing: parseJson<Record<string, any>>(r.pricing) ?? {},
  };
}

// Batch helper: lookup many addresses at once (avoids N+1 queries on the
// buyer profile page).
export async function lookupProviders(
  addresses: (string | null | undefined)[],
): Promise<Map<string, ProviderRow>> {
  const lc = addresses
    .filter((a): a is string => !!a)
    .map((a) => a.toLowerCase());
  if (lc.length === 0) return new Map();
  const rows = await db
    .select()
    .from(providerDirectory)
    .where(sql`${providerDirectory.address} = ANY(${lc})`);
  const m = new Map<string, ProviderRow>();
  for (const r of rows) {
    m.set(r.address, {
      address: r.address,
      display_name: r.displayName,
      peer_id: r.peerId,
      region: r.region,
      trust_score: r.trustScore,
      services: parseJson<string[]>(r.services) ?? [],
      pricing: parseJson<Record<string, any>>(r.pricing) ?? {},
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
