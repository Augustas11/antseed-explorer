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
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 25)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const minScore = Math.max(0, Math.min(100, opts.minScore ?? 0));
  const orderCol =
    opts.sort === "volume" ? "total_settled_usdc DESC"
    : opts.sort === "sessions" ? "total_sessions DESC"
    : opts.sort === "first_seen" ? "first_seen_block ASC NULLS LAST"
    : "trust_score DESC";
  const qualClause = opts.qualifiedOnly ? "AND qualified = true" : "";

  // Raw SQL — Drizzle's chained query builder under Neon HTTP returned empty
  // rows for specific (sort, limit) combinations on Vercel cold starts.
  // No user input is interpolated; all values are sanitized integers / fixed enum strings.
  const r = await db.execute<any>(sql`
    SELECT * FROM buyer_profiles
    WHERE trust_score >= ${sql.raw(String(minScore))}
    ${sql.raw(qualClause)}
    ORDER BY ${sql.raw(orderCol)}
    LIMIT ${sql.raw(String(limit))}
    OFFSET ${sql.raw(String(offset))}
  `);
  return r.rows.map((row: any) => ({
    address: row.address,
    total_sessions: Number(row.total_sessions ?? 0),
    total_settled_usdc: Number(row.total_settled_usdc ?? 0),
    unique_sellers: Number(row.unique_sellers ?? 0),
    ghost_sessions: Number(row.ghost_sessions ?? 0),
    first_seen_block: row.first_seen_block != null ? Number(row.first_seen_block) : null,
    last_seen_block: row.last_seen_block != null ? Number(row.last_seen_block) : null,
    first_seen_ts: row.first_seen_ts != null ? Number(row.first_seen_ts) : null,
    last_seen_ts: row.last_seen_ts != null ? Number(row.last_seen_ts) : null,
    trust_score: Number(row.trust_score ?? 0),
    qualified: row.qualified ? 1 : 0,
  }));
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
  // One round-trip — combine all aggregates into a single query.
  // Avoids serverless cold-start connection-setup races with Neon's HTTP driver.
  const r = await db.execute<{
    total_buyers: number;
    qualified_buyers: number;
    total_volume: number;
    total_sessions: number;
    total_ghosts: number;
    last_indexed_block: string | null;
    last_head_block: string | null;
    last_sync_ts: string | null;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM buyer_profiles) AS total_buyers,
      (SELECT COUNT(*)::int FROM buyer_profiles WHERE qualified = true) AS qualified_buyers,
      (SELECT COALESCE(SUM(total_settled_usdc),0)::float FROM buyer_profiles) AS total_volume,
      (SELECT COALESCE(SUM(total_sessions),0)::int FROM buyer_profiles) AS total_sessions,
      (SELECT COALESCE(SUM(ghost_sessions),0)::int FROM buyer_profiles) AS total_ghosts,
      (SELECT value FROM indexer_state WHERE key = 'last_indexed_block') AS last_indexed_block,
      (SELECT value FROM indexer_state WHERE key = 'last_head_block') AS last_head_block,
      (SELECT value FROM indexer_state WHERE key = 'last_sync_ts') AS last_sync_ts
  `);
  const x = r.rows[0];
  return {
    totalBuyers: Number(x?.total_buyers ?? 0),
    qualifiedBuyers: Number(x?.qualified_buyers ?? 0),
    totalVolumeUsdc: Number(x?.total_volume ?? 0),
    totalSessions: Number(x?.total_sessions ?? 0),
    totalGhosts: Number(x?.total_ghosts ?? 0),
    lastIndexedBlock: x?.last_indexed_block ? Number(x.last_indexed_block) : null,
    lastHeadBlock: x?.last_head_block ? Number(x.last_head_block) : null,
    lastSyncTs: x?.last_sync_ts ? Number(x.last_sync_ts) : null,
  };
}

export async function getDailyVolume(days = 30) {
  // sql.raw(String(days)) — Drizzle's parameterized binding via Neon HTTP
  // returns empty rows for arithmetic on bigint columns when the param is a
  // plain JS number; raw inlining works reliably. `days` is internal, not
  // user input, so this is safe.
  const d = Math.max(1, Math.floor(days));
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
      AND timestamp > extract(epoch from now())::bigint - ${sql.raw(String(d))} * 86400
    GROUP BY day
    ORDER BY day ASC
  `);
  return rows.rows;
}

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
  const lc = [
    ...new Set(
      addresses.filter((a): a is string => !!a).map((a) => a.toLowerCase()),
    ),
  ];
  if (lc.length === 0) return new Map();
  // Inline the address list — array params via Neon HTTP have been unreliable.
  // Each address is a strict 0x + 40 hex chars, so we sanitize and inline.
  const safe = lc
    .filter((a) => /^0x[0-9a-f]{40}$/.test(a))
    .map((a) => `'${a}'`)
    .join(",");
  if (!safe) return new Map();
  const rows = (
    await db.execute<any>(
      sql`SELECT * FROM provider_directory WHERE address IN (${sql.raw(safe)})`,
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
