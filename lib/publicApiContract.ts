export const BUYER_SORTS = [
  "volume",
  "sessions",
  "score",
  "first_seen",
  "unique_sellers",
  "ghosts",
] as const;
export const BUYER_DEFAULT_SORT = "volume";
export type BuyerSort = (typeof BUYER_SORTS)[number];

export const SELLER_SORTS = [
  "volume",
  "sessions",
  "buyers",
  "ghosts",
  "first_seen",
] as const;
export const SELLER_DEFAULT_SORT = "volume";
export type SellerSort = (typeof SELLER_SORTS)[number];

export const CHANNEL_SORTS = [
  "amount",
  "settled",
  "events",
  "opened",
  "last_activity",
] as const;
export const CHANNEL_DEFAULT_SORT = "opened";
export type ChannelSort = (typeof CHANNEL_SORTS)[number];

export const PROVIDER_SORTS = [
  "volume",
  "score",
  "sessions",
  "ghost",
  "joined",
  "reputation",
  "recent",
] as const;
export const PROVIDER_DEFAULT_SORT = "volume";
export type ProviderSort = (typeof PROVIDER_SORTS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export const DEFAULT_SORT_DIRECTION = "desc";

export const EXPORT_FORMATS = ["csv", "json"] as const;

export const PUBLIC_OPENAPI_ROUTE_EXCLUSIONS = [
  "/api/cron/signals",
  "/api/cron/sync",
  "/api/keys",
  "/api/openapi.json",
] as const;

export const PUBLIC_RESPONSE_FIELDS = {
  BuyerRow: [
    "address",
    "total_sessions",
    "total_settled_usdc",
    "unique_sellers",
    "ghost_sessions",
    "first_seen_block",
    "last_seen_block",
    "first_seen_ts",
    "last_seen_ts",
    "trust_score",
    "qualified",
  ],
  SellerRow: [
    "address",
    "unique_buyers",
    "total_sessions",
    "total_earned_usdc",
    "ghost_sessions",
    "first_seen_ts",
    "last_seen_ts",
    "first_seen_block",
    "last_seen_block",
  ],
  ChannelRow: [
    "channel_id",
    "buyer_address",
    "seller_address",
    "state",
    "opened_block",
    "last_block",
    "opened_ts",
    "last_ts",
    "max_amount_usdc",
    "settled_amount_usdc",
    "total_delta_usdc",
    "event_count",
  ],
  ServicePricing: ["inputUsdPerMillion", "outputUsdPerMillion"],
  DirectoryProviderRow: [
    "address",
    "displayName",
    "region",
    "services",
    "pricing",
    "sessionCount",
    "totalVolumeUsdc",
    "ghostCount",
    "closedCount",
    "updatedAt",
    "operatorAddress",
  ],
  SellerServicesResponse: [
    "address",
    "displayName",
    "region",
    "services",
    "pricing",
    "updatedAt",
  ],
  BuyerSessionEvent: [
    "tx_hash",
    "block_number",
    "event_type",
    "seller_address",
    "channel_id",
    "delta_usdc",
    "settled_amount_usdc",
    "timestamp",
    "seller_label",
  ],
  BuyerSellerSummaryRow: [
    "seller_address",
    "sessions",
    "total_usdc",
    "seller_label",
  ],
  BuyerMonthlyVolumeRow: ["month", "sessions", "volume"],
  BuyerProfileResponse: ["profile", "sessions", "topSellers", "monthly"],
  TrustScoreBreakdown: [
    "total",
    "qualified",
    "volume",
    "consistency",
    "diversity",
    "reliability",
  ],
  ScoreStats: [
    "totalSessions",
    "totalSettledUsdc",
    "uniqueSellers",
    "ghostSessions",
    "firstSeenBlock",
    "lastSeenBlock",
  ],
  ScoreResponse: ["address", "score", "tier", "qualified", "breakdown", "stats"],
  ProfileDrift: ["eventsUsdc", "profilesUsdc", "driftUsdc"],
  StatsDailyRow: [
    "day",
    "sessions",
    "volume",
    "active_buyers",
    "daily_active_users",
    "new_users",
  ],
  StatsResponse: [
    "totalBuyers",
    "qualifiedBuyers",
    "totalVolumeUsdc",
    "totalSessions",
    "totalGhosts",
    "lastIndexedBlock",
    "lastHeadBlock",
    "lastSyncTs",
    "drift",
    "daily",
  ],
  DauDayRow: ["day", "new", "existing", "total", "dau_buyers", "dau_sellers"],
  BuyersPage: ["buyers", "total", "limit", "offset"],
  SellersPage: ["sellers", "total", "limit", "offset"],
  ChannelsPage: ["channels", "total", "limit", "offset"],
  ProvidersPage: ["providers", "total", "limit", "offset"],
  GasResponse: ["gwei"],
  ReadContractResponse: ["ok", "result"],
  SyncResponse: [
    "ok",
    "fromBlock",
    "toBlock",
    "eventsAdded",
    "buyersTouched",
    "skipped",
    "error",
  ],
} as const;

export type PublicResponseSchemaName = keyof typeof PUBLIC_RESPONSE_FIELDS;
