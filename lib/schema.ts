// Drizzle schema for the Postgres backend (Neon).
// Mirrors the original SQLite schema 1:1 in semantics; types tightened where
// Postgres lets us be precise (numeric instead of REAL for USDC, bigint for
// token counts, timestamptz for indexer state timestamps).

import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    buyerAddress: text("buyer_address"),
    sellerAddress: text("seller_address"),
    channelId: text("channel_id"),
    maxAmountUsdc: doublePrecision("max_amount_usdc"),
    deltaUsdc: doublePrecision("delta_usdc"),
    refundUsdc: doublePrecision("refund_usdc"),
    settledAmountUsdc: doublePrecision("settled_amount_usdc"),
    cumulativeAmountUsdc: doublePrecision("cumulative_amount_usdc"),
    platformFeeUsdc: doublePrecision("platform_fee_usdc"),
    newDepositUsdc: doublePrecision("new_deposit_usdc"),
    gracePeriodEnd: bigint("grace_period_end", { mode: "number" }),
    inputTokens: bigint("input_tokens", { mode: "number" }),
    outputTokens: bigint("output_tokens", { mode: "number" }),
    requestCount: integer("request_count"),
    timestamp: bigint("timestamp", { mode: "number" }),
    rawLog: text("raw_log"),
  },
  (t) => ({
    uxTxLog: uniqueIndex("events_tx_log_uniq").on(t.txHash, t.logIndex),
    ixBuyer: index("events_buyer_idx").on(t.buyerAddress),
    ixSeller: index("events_seller_idx").on(t.sellerAddress),
    ixBlock: index("events_block_idx").on(t.blockNumber),
    ixType: index("events_type_idx").on(t.eventType),
    ixChannel: index("events_channel_idx").on(t.channelId),
    ixTimestamp: index("events_timestamp_idx").on(t.timestamp),
    ixTypeTs: index("events_type_ts_idx").on(t.eventType, t.timestamp),
  }),
);

export const buyerProfiles = pgTable(
  "buyer_profiles",
  {
    address: text("address").primaryKey(),
    totalSessions: integer("total_sessions").notNull().default(0),
    totalSettledUsdc: doublePrecision("total_settled_usdc").notNull().default(0),
    uniqueSellers: integer("unique_sellers").notNull().default(0),
    ghostSessions: integer("ghost_sessions").notNull().default(0),
    firstSeenBlock: bigint("first_seen_block", { mode: "number" }),
    lastSeenBlock: bigint("last_seen_block", { mode: "number" }),
    firstSeenTs: bigint("first_seen_ts", { mode: "number" }),
    lastSeenTs: bigint("last_seen_ts", { mode: "number" }),
    trustScore: doublePrecision("trust_score").notNull().default(0),
    qualified: boolean("qualified").notNull().default(false),
    updatedAt: bigint("updated_at", { mode: "number" }),
  },
  (t) => ({
    ixScore: index("buyer_score_idx").on(t.trustScore),
    ixVolume: index("buyer_volume_idx").on(t.totalSettledUsdc),
  }),
);

export const indexerState = pgTable("indexer_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const providerDirectory = pgTable("provider_directory", {
  address: text("address").primaryKey(),
  displayName: text("display_name"),
  peerId: text("peer_id"),
  region: text("region"),
  trustScore: doublePrecision("trust_score"),
  services: text("services"), // JSON array
  pricing: text("pricing"),   // JSON object
  description: text("description"), // Markdown long-form "About this provider"
  // When set, `address` is a seller delegation contract that settles on
  // AntseedChannels on behalf of `operator_address` (the peerId-derived
  // operator EVM address). When null, `address` IS the operator and settles
  // directly. See refreshProviderDirectory().
  operatorAddress: text("operator_address"),
  updatedAt: bigint("updated_at", { mode: "number" }),
});

export const apiKeys = pgTable("api_keys", {
  key: text("key").primaryKey(),
  label: text("label"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Daily Active Users pre-aggregate. One row per UTC day; populated by
// recomputeDailyDau() after each indexer pass. Mirrors Dune query 6974179
// exactly: DAU = COUNT(DISTINCT addr) across 8 (event_type, address) pairs
// from AntseedDeposits + AntseedChannels. new_users tracks lifetime-first
// Deposited only (sellers can never be "new").
export const dailyDau = pgTable("daily_dau", {
  day: date("day").primaryKey(),
  dau: integer("dau").notNull().default(0),
  dauBuyers: integer("dau_buyers").notNull().default(0),
  dauSellers: integer("dau_sellers").notNull().default(0),
  newUsers: integer("new_users").notNull().default(0),
  lastRecomputedAt: bigint("last_recomputed_at", { mode: "number" }),
});

// Live $ANT balance per address. Maintained incrementally by the indexer
// from Transfer events on the ANTS token. Balance is stored as raw
// uint256-scale wei (numeric arbitrary-precision); an address counts as a
// holder when balance > 0.
export const antsHolders = pgTable(
  "ants_holders",
  {
    address: text("address").primaryKey(),
    balance: numeric("balance", { precision: 78, scale: 0 }).notNull().default("0"),
    firstSeenBlock: bigint("first_seen_block", { mode: "number" }),
    lastSeenBlock: bigint("last_seen_block", { mode: "number" }),
    updatedAt: bigint("updated_at", { mode: "number" }),
  },
  (t) => ({
    ixBalance: index("ants_holders_balance_idx").on(t.balance),
  }),
);
