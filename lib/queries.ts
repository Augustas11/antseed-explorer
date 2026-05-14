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
  sort?: "score" | "volume" | "sessions" | "first_seen" | "unique_sellers" | "ghosts";
} = {}): Promise<BuyerRow[]> {
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 25)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const minScore = Math.max(0, Math.min(100, Number.isFinite(opts.minScore ?? 0) ? (opts.minScore ?? 0) : 0));
  const orderCol =
    opts.sort === "volume" ? "total_settled_usdc DESC"
    : opts.sort === "sessions" ? "total_sessions DESC"
    : opts.sort === "first_seen" ? "first_seen_block ASC NULLS LAST"
    : opts.sort === "unique_sellers" ? "unique_sellers DESC"
    : opts.sort === "ghosts" ? "ghost_sessions DESC"
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
  const minScore = Math.max(0, Math.min(100, Number.isFinite(opts.minScore ?? 0) ? (opts.minScore ?? 0) : 0));
  const qualClause = opts.qualifiedOnly ? "AND qualified = true" : "";
  const r = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM buyer_profiles
    WHERE trust_score >= ${sql.raw(String(minScore))}
    ${sql.raw(qualClause)}
  `);
  return Number(r.rows[0]?.n ?? 0);
}

export async function getBuyer(address: string): Promise<BuyerRow | null> {
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

export async function getBuyerSessions(address: string, limit = 25) {
  const r = await db.execute<any>(sql`
    SELECT tx_hash, log_index, block_number, event_type, buyer_address, seller_address,
           channel_id, delta_usdc, settled_amount_usdc, input_tokens, output_tokens,
           request_count, timestamp
    FROM events
    WHERE buyer_address = ${address.toLowerCase()}
    ORDER BY block_number DESC, log_index DESC
    LIMIT ${sql.raw(String(limit))}
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

export async function getBuyerMonthlyVolume(address: string) {
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
  const d = Math.max(1, Math.floor(days));
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
      AND timestamp > extract(epoch from now())::bigint - ${sql.raw(String(d))} * 86400
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  return rows.rows;
}

export async function getBuyerHourlyVolume(address: string, hours = 24) {
  const h = Math.max(1, Math.floor(hours));
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
      AND timestamp > extract(epoch from now())::bigint - ${sql.raw(String(h))} * 3600
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
  // Paying Users — distinct on-chain addresses that paid USDC. The next phase
  // will expand this denominator to include $ANT holders (live balance > 0).
  totalPayingUsers: number;
  recentPayingUsers: number;
  priorPayingUsers: number;
}

export async function getHeroStats(): Promise<HeroStats> {
  // Window cutoffs inlined as ints — same Neon-HTTP/Drizzle quirk that the
  // rest of this file works around with sql.raw.
  const now = Math.floor(Date.now() / 1000);
  const day30 = String(now - 30 * 86400);
  const day60 = String(now - 60 * 86400);

  // All-time totals aggregate channel-by-channel because the on-chain
  // ChannelSettled event reports CUMULATIVE values per channel (totalSettled
  // for USDC; metadata token counts follow the same convention). SUM-over-
  // events double-counts; MAX-per-channel gives the canonical "what does the
  // chain say this channel finally moved" figure, matching the Dune board.
  //
  // Windowed (recent / prior 30d) comparisons stay SUM-of-deltas — those are
  // an activity signal, not a balance, and SUM-in-window is the right shape.
  const r = await db.execute<any>(sql`
    WITH s AS (
      SELECT
        channel_id,
        timestamp,
        delta_usdc,
        settled_amount_usdc,
        COALESCE(input_tokens, 0)  AS in_tok,
        COALESCE(output_tokens, 0) AS out_tok
      FROM events
      WHERE event_type = 'settled'
        AND timestamp IS NOT NULL
        AND timestamp > 0
        AND timestamp < 32503680000
    ),
    channel_totals AS (
      SELECT
        channel_id,
        MAX(settled_amount_usdc) AS total_revenue,
        MAX(in_tok)              AS total_in_tok,
        MAX(out_tok)             AS total_out_tok
      FROM s
      WHERE channel_id IS NOT NULL
      GROUP BY channel_id
    ),
    p AS (
      SELECT buyer_address, timestamp
      FROM events
      WHERE event_type IN ('settled', 'topup')
        AND buyer_address IS NOT NULL
        AND timestamp IS NOT NULL
        AND timestamp > 0
    )
    SELECT
      (SELECT COALESCE(SUM(total_in_tok + total_out_tok),0)::bigint FROM channel_totals) AS total_tokens,
      (SELECT COALESCE(SUM(total_in_tok),0)::bigint                 FROM channel_totals) AS total_tokens_input,
      (SELECT COALESCE(SUM(total_out_tok),0)::bigint                FROM channel_totals) AS total_tokens_output,
      (SELECT COALESCE(SUM(in_tok + out_tok),0)::bigint             FROM s WHERE timestamp > ${sql.raw(day30)}) AS recent_tokens,
      (SELECT COALESCE(SUM(in_tok + out_tok),0)::bigint             FROM s WHERE timestamp > ${sql.raw(day60)} AND timestamp <= ${sql.raw(day30)}) AS prior_tokens,

      (SELECT COALESCE(SUM(total_revenue),0)::float                 FROM channel_totals) AS total_revenue,
      (SELECT COALESCE(SUM(delta_usdc),0)::float                    FROM s WHERE timestamp > ${sql.raw(day30)}) AS recent_revenue,
      (SELECT COALESCE(SUM(delta_usdc),0)::float                    FROM s WHERE timestamp > ${sql.raw(day60)} AND timestamp <= ${sql.raw(day30)}) AS prior_revenue,

      (SELECT COUNT(DISTINCT buyer_address)::int                    FROM p) AS total_paying_users,
      (SELECT COUNT(DISTINCT buyer_address)::int                    FROM p WHERE timestamp > ${sql.raw(day30)}) AS recent_paying_users,
      (SELECT COUNT(DISTINCT buyer_address)::int                    FROM p WHERE timestamp > ${sql.raw(day60)} AND timestamp <= ${sql.raw(day30)}) AS prior_paying_users
  `);

  const x = r.rows[0] ?? {};
  return {
    totalRevenueUsdc: Number(x.total_revenue ?? 0),
    recentRevenueUsdc: Number(x.recent_revenue ?? 0),
    priorRevenueUsdc: Number(x.prior_revenue ?? 0),
    totalTokens: Number(x.total_tokens ?? 0),
    totalTokensInput: Number(x.total_tokens_input ?? 0),
    totalTokensOutput: Number(x.total_tokens_output ?? 0),
    recentTokens: Number(x.recent_tokens ?? 0),
    priorTokens: Number(x.prior_tokens ?? 0),
    totalPayingUsers: Number(x.total_paying_users ?? 0),
    recentPayingUsers: Number(x.recent_paying_users ?? 0),
    priorPayingUsers: Number(x.prior_paying_users ?? 0),
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

// ---------------------------------------------------------------------------
// lookupAddress
// ---------------------------------------------------------------------------

export async function lookupAddress(
  addr: string,
): Promise<{ type: "buyer" | "seller"; address: string } | null> {
  const normalized = addr.toLowerCase();

  const buyerR = await db.execute<{ address: string }>(sql`
    SELECT address FROM buyer_profiles WHERE address = ${normalized} LIMIT 1
  `);
  if (buyerR.rows.length > 0) {
    return { type: "buyer", address: normalized };
  }

  const sellerR = await db.execute<{ seller_address: string }>(sql`
    SELECT seller_address FROM events WHERE seller_address = ${normalized} LIMIT 1
  `);
  if (sellerR.rows.length > 0) {
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
  sort?: "volume" | "sessions" | "buyers" | "ghosts" | "first_seen";
  dir?: "asc" | "desc";
} = {}): Promise<SellerRow[]> {
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 25)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const sortColMap: Record<string, string> = {
    volume: "total_earned_usdc",
    sessions: "total_sessions",
    buyers: "unique_buyers",
    ghosts: "ghost_sessions",
    first_seen: "first_seen_ts",
  };
  const sortCol = sortColMap[opts.sort ?? ""] ?? "total_earned_usdc";
  // first_seen defaults to asc; everything else defaults to desc
  const dir = opts.dir ?? (opts.sort === "first_seen" ? "asc" : "desc");
  const orderExpr = `${sortCol} ${dir.toUpperCase()}`;

  const r = await db.execute<any>(sql`
    SELECT
      seller_address                                                         AS address,
      COUNT(DISTINCT buyer_address)::int                                     AS unique_buyers,
      COUNT(*) FILTER (WHERE event_type = 'settled')::int                    AS total_sessions,
      COALESCE(SUM(delta_usdc) FILTER (WHERE event_type = 'settled'), 0)::float AS total_earned_usdc,
      COUNT(*) FILTER (WHERE event_type = 'closed' AND (settled_amount_usdc IS NULL OR settled_amount_usdc = 0))::int AS ghost_sessions,
      MIN(timestamp)                                                         AS first_seen_ts,
      MAX(timestamp)                                                         AS last_seen_ts,
      MIN(block_number)                                                      AS first_seen_block,
      MAX(block_number)                                                      AS last_seen_block
    FROM events
    WHERE seller_address IS NOT NULL
    GROUP BY seller_address
    ORDER BY ${sql.raw(orderExpr)}
    LIMIT ${sql.raw(String(limit))}
    OFFSET ${sql.raw(String(offset))}
  `);
  return r.rows.map(shapeSellerRow);
}

export async function countSellers(): Promise<number> {
  const r = await db.execute<{ n: number }>(sql`
    SELECT COUNT(DISTINCT seller_address)::int AS n
    FROM events
    WHERE seller_address IS NOT NULL
  `);
  return Number(r.rows[0]?.n ?? 0);
}

export async function getSeller(address: string): Promise<SellerRow | null> {
  const r = await db.execute<any>(sql`
    SELECT
      seller_address                                                         AS address,
      COUNT(DISTINCT buyer_address)::int                                     AS unique_buyers,
      COUNT(*) FILTER (WHERE event_type = 'settled')::int                    AS total_sessions,
      COALESCE(SUM(delta_usdc) FILTER (WHERE event_type = 'settled'), 0)::float AS total_earned_usdc,
      COUNT(*) FILTER (WHERE event_type = 'closed' AND (settled_amount_usdc IS NULL OR settled_amount_usdc = 0))::int AS ghost_sessions,
      MIN(timestamp)                                                         AS first_seen_ts,
      MAX(timestamp)                                                         AS last_seen_ts,
      MIN(block_number)                                                      AS first_seen_block,
      MAX(block_number)                                                      AS last_seen_block
    FROM events
    WHERE seller_address = ${address.toLowerCase()}
    GROUP BY seller_address
  `);
  const row = r.rows[0];
  if (!row || row.address == null) return null;
  return shapeSellerRow(row);
}

export async function getSellerDailyVolume(address: string, days = 30) {
  const d = Math.max(1, Math.floor(days));
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
      AND timestamp > extract(epoch from now())::bigint - ${sql.raw(String(d))} * 86400
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  return rows.rows;
}

export async function getSellerHourlyVolume(address: string, hours = 24) {
  const h = Math.max(1, Math.floor(hours));
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
      AND timestamp > extract(epoch from now())::bigint - ${sql.raw(String(h))} * 3600
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  return rows.rows;
}

export async function getSellerBuyerSummary(
  address: string,
  limit = 10,
): Promise<{ buyer_address: string; sessions: number; total_usdc: number }[]> {
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
    LIMIT ${limit}
  `);
  return rows.rows;
}

// ---------------------------------------------------------------------------
// getHourlyVolume
// ---------------------------------------------------------------------------

export async function getHourlyVolume(hours = 24): Promise<
  { day: string; sessions: number; volume: number; active_buyers: number }[]
> {
  const h = Math.max(1, Math.floor(hours));
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
      AND timestamp > extract(epoch from now())::bigint - ${sql.raw(String(h))} * 3600
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
  const r = await db.execute<any>(sql`
    SELECT tx_hash, log_index, block_number, event_type, buyer_address, seller_address,
           channel_id, delta_usdc, settled_amount_usdc, timestamp
    FROM events
    ORDER BY block_number DESC, log_index DESC
    LIMIT ${sql.raw(String(limit))}
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
  sort?: "amount" | "settled" | "events" | "opened" | "last_activity";
  dir?: "asc" | "desc";
} = {}): Promise<ChannelRow[]> {
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 25)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const sortColMap: Record<string, string> = {
    amount: "max_amount_usdc",
    settled: "settled_amount_usdc",
    events: "event_count",
    opened: "opened_ts",
    last_activity: "last_ts",
  };
  const sortCol = sortColMap[opts.sort ?? ""] ?? "opened_ts";
  const dir = opts.dir ?? "desc";
  const orderExpr = `${sortCol} ${dir.toUpperCase()}`;

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
      bool_or(event_type = 'Closed')   AS closed,
      bool_or(event_type = 'Reserved') AS reserved,
      COUNT(*)::int                 AS event_count
    FROM events
    WHERE channel_id IS NOT NULL
    GROUP BY channel_id
    ORDER BY ${sql.raw(orderExpr)}
    LIMIT ${sql.raw(String(limit))}
    OFFSET ${sql.raw(String(offset))}
  `);
  return r.rows.map(shapeChannelRow);
}

export async function countChannels(): Promise<number> {
  const r = await db.execute<{ n: number }>(sql`
    SELECT COUNT(DISTINCT channel_id)::int AS n
    FROM events
    WHERE channel_id IS NOT NULL
  `);
  return Number(r.rows[0]?.n ?? 0);
}

export async function getChannel(id: string): Promise<ChannelRow | null> {
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
      bool_or(event_type = 'Closed')   AS closed,
      bool_or(event_type = 'Reserved') AS reserved,
      COUNT(*)::int                 AS event_count
    FROM events
    WHERE channel_id = ${id}
    GROUP BY channel_id
  `);
  const row = r.rows[0];
  if (!row || row.channel_id == null) return null;
  return shapeChannelRow(row);
}

export async function getChannelEvents(
  channelId: string,
  limit = 100,
) {
  const r = await db.execute<any>(sql`
    SELECT tx_hash, log_index, block_number, event_type, buyer_address, seller_address,
           channel_id, delta_usdc, settled_amount_usdc, input_tokens, output_tokens,
           request_count, timestamp
    FROM events
    WHERE channel_id = ${channelId}
    ORDER BY block_number ASC, log_index ASC
    LIMIT ${sql.raw(String(limit))}
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

export interface ServiceRow {
  name: string;
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
    pricing: { inputUsdPerMillion?: number; outputUsdPerMillion?: number } | null;
  }>;
}

type PricingMap = Record<string, { inputUsdPerMillion?: number; outputUsdPerMillion?: number }>;

export async function listServices(): Promise<ServiceRow[]> {
  const allProviders = (await db.execute<any>(sql`
    SELECT address, display_name, services, pricing FROM provider_directory
  `)).rows;

  // Build Map<serviceName, { providers: string[], prices: { in: number[], out: number[] } }>
  const serviceMap = new Map<string, {
    providers: string[];
    pricesIn: number[];
    pricesOut: number[];
  }>();

  for (const provider of allProviders) {
    const services = parseJson<string[]>(provider.services) ?? [];
    const pricing = parseJson<PricingMap>(provider.pricing) ?? {};
    for (const svc of services) {
      if (!serviceMap.has(svc)) {
        serviceMap.set(svc, { providers: [], pricesIn: [], pricesOut: [] });
      }
      const entry = serviceMap.get(svc)!;
      entry.providers.push(provider.address);
      const svcPricing = pricing[svc];
      if (svcPricing?.inputUsdPerMillion != null) entry.pricesIn.push(svcPricing.inputUsdPerMillion);
      if (svcPricing?.outputUsdPerMillion != null) entry.pricesOut.push(svcPricing.outputUsdPerMillion);
    }
  }

  const result: ServiceRow[] = [];
  for (const [name, { providers, pricesIn, pricesOut }] of serviceMap) {
    result.push({
      name,
      provider_count: providers.length,
      providers,
      min_price_in: pricesIn.length > 0 ? Math.min(...pricesIn) : null,
      max_price_in: pricesIn.length > 0 ? Math.max(...pricesIn) : null,
      min_price_out: pricesOut.length > 0 ? Math.min(...pricesOut) : null,
      max_price_out: pricesOut.length > 0 ? Math.max(...pricesOut) : null,
    });
  }

  // Sort by provider_count desc, then name asc
  result.sort((a, b) =>
    b.provider_count !== a.provider_count
      ? b.provider_count - a.provider_count
      : a.name.localeCompare(b.name),
  );
  return result;
}

export async function getService(name: string): Promise<ServiceProviderRow | null> {
  const allProviders = (await db.execute<any>(sql`
    SELECT address, display_name, services, pricing FROM provider_directory
  `)).rows;

  const providers: string[] = [];
  const pricesIn: number[] = [];
  const pricesOut: number[] = [];
  const providerDetails: ServiceProviderRow["provider_details"] = [];

  for (const provider of allProviders) {
    const services = parseJson<string[]>(provider.services) ?? [];
    if (!services.includes(name)) continue;
    const pricing = parseJson<PricingMap>(provider.pricing) ?? {};
    const svcPricing = pricing[name] ?? null;
    providers.push(provider.address);
    if (svcPricing?.inputUsdPerMillion != null) pricesIn.push(svcPricing.inputUsdPerMillion);
    if (svcPricing?.outputUsdPerMillion != null) pricesOut.push(svcPricing.outputUsdPerMillion);
    providerDetails.push({
      address: provider.address,
      display_name: provider.display_name ?? null,
      pricing: svcPricing,
    });
  }

  if (providers.length === 0) return null;

  return {
    name,
    provider_count: providers.length,
    providers,
    min_price_in: pricesIn.length > 0 ? Math.min(...pricesIn) : null,
    max_price_in: pricesIn.length > 0 ? Math.max(...pricesIn) : null,
    min_price_out: pricesOut.length > 0 ? Math.min(...pricesOut) : null,
    max_price_out: pricesOut.length > 0 ? Math.max(...pricesOut) : null,
    provider_details: providerDetails,
  };
}

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
}

export async function listProviders(opts: {
  sort?: "volume" | "sessions" | "ghost";
} = {}): Promise<DirectoryProviderRow[]> {
  const sortColMap: Record<string, string> = {
    volume: "COALESCE(agg.total_volume, 0) DESC",
    sessions: "COALESCE(agg.session_count, 0) DESC",
    ghost: "CASE WHEN COALESCE(agg.closed_count,0)>0 THEN COALESCE(agg.ghost_count,0)::float/agg.closed_count ELSE 0 END DESC",
  };
  const orderExpr = sortColMap[opts.sort ?? ""] ?? "COALESCE(agg.total_volume, 0) DESC";

  const rows = (await db.execute<any>(sql`
    SELECT
      pd.address,
      pd.display_name,
      pd.region,
      pd.services,
      pd.pricing,
      pd.updated_at,
      COALESCE(agg.session_count, 0)::int   AS session_count,
      COALESCE(agg.total_volume, 0)::float  AS total_volume,
      COALESCE(agg.ghost_count, 0)::int     AS ghost_count,
      COALESCE(agg.closed_count, 0)::int    AS closed_count
    FROM provider_directory pd
    LEFT JOIN (
      SELECT
        seller_address,
        COUNT(DISTINCT CASE WHEN event_type='settled' THEN channel_id END)::int      AS session_count,
        COALESCE(SUM(CASE WHEN event_type='settled' THEN delta_usdc ELSE 0 END),0)::float AS total_volume,
        COUNT(DISTINCT CASE WHEN event_type='closed' AND COALESCE(settled_amount_usdc,0)=0 THEN channel_id END)::int AS ghost_count,
        COUNT(DISTINCT CASE WHEN event_type='closed' THEN channel_id END)::int       AS closed_count
      FROM events
      WHERE seller_address IS NOT NULL
      GROUP BY seller_address
    ) agg ON agg.seller_address = pd.address
    ORDER BY ${sql.raw(orderExpr)}
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
  }));
}
