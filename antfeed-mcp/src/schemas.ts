import { z } from "zod";

const ETH_ADDRESS = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 40-hex-character Ethereum address");
const CHANNEL_ID = z
  .string()
  .regex(/^0x[0-9a-fA-F]{1,128}$/, "must be a 0x-prefixed hex string up to 128 chars");
const SERVICE_ID = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.\-:/]+$/, "must be a short service identifier");
const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date in YYYY-MM-DD form");

export const PAGINATION_DEFAULT_LIMIT = 50;
export const PAGINATION_MAX_LIMIT = 200;

export const lookupSchema = z.object({
  query: z.string().min(1).max(256, "query is too long"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(PAGINATION_MAX_LIMIT)
    .default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().max(256).optional(),
});

export const listProvidersSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(PAGINATION_MAX_LIMIT)
    .default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().max(256).optional(),
  sort: z.enum(["score", "recent"]).default("score"),
});

export const getPricingSchema = z.object({
  peerId: ETH_ADDRESS,
  service: SERVICE_ID,
});

export const getSessionStatusSchema = z.object({
  sessionId: CHANNEL_ID,
});

export const createSessionSchema = z.object({
  providerPeerId: ETH_ADDRESS,
  service: SERVICE_ID,
  initialDepositUsdc: z.number().positive().finite(),
  initialMessage: z.string().max(4_000).optional(),
});

export const getBuyerSchema = z.object({
  address: ETH_ADDRESS,
});

const MAX_DAU_WINDOW_DAYS = 366;

export const dauTrendSchema = z
  .object({
    from: ISO_DATE.optional(),
    to: ISO_DATE.optional(),
    granularity: z.literal("day").default("day"),
  })
  .refine((v) => !(v.from && v.to) || v.from <= v.to, {
    message: "from must be on or before to",
    path: ["from"],
  })
  .refine(
    (v) => {
      if (!v.from || !v.to) return true;
      const from = Date.parse(v.from + "T00:00:00Z");
      const to = Date.parse(v.to + "T00:00:00Z");
      if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
      const days = Math.round((to - from) / 86_400_000) + 1;
      return days <= MAX_DAU_WINDOW_DAYS;
    },
    { message: `window may not exceed ${MAX_DAU_WINDOW_DAYS} days`, path: ["to"] },
  );

export type LookupInput = z.infer<typeof lookupSchema>;
export type ListProvidersInput = z.infer<typeof listProvidersSchema>;
export type GetPricingInput = z.infer<typeof getPricingSchema>;
export type GetSessionStatusInput = z.infer<typeof getSessionStatusSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type GetBuyerInput = z.infer<typeof getBuyerSchema>;
export type DauTrendInput = z.infer<typeof dauTrendSchema>;

const HexHash = z.string().regex(/^0x[0-9a-fA-F]{1,128}$/);

export const SellerRowZ = z
  .object({
    address: ETH_ADDRESS,
    unique_buyers: z.number().int().nonnegative(),
    total_sessions: z.number().int().nonnegative(),
    total_earned_usdc: z.number().finite().nonnegative(),
    ghost_sessions: z.number().int().nonnegative(),
    first_seen_ts: z.number().int().nullable(),
    last_seen_ts: z.number().int().nullable(),
    first_seen_block: z.number().int().nullable(),
    last_seen_block: z.number().int().nullable(),
  })
  .passthrough();

export const BuyerRowZ = z
  .object({
    address: ETH_ADDRESS,
    total_sessions: z.number().int().nonnegative(),
    total_settled_usdc: z.number().finite().nonnegative(),
    unique_sellers: z.number().int().nonnegative(),
    ghost_sessions: z.number().int().nonnegative(),
    first_seen_ts: z.number().int().nullable(),
    last_seen_ts: z.number().int().nullable(),
    first_seen_block: z.number().int().nullable(),
    last_seen_block: z.number().int().nullable(),
    trust_score: z.number().finite(),
    qualified: z.union([z.literal(0), z.literal(1)]),
  })
  .passthrough();

export const ChannelRowZ = z
  .object({
    channel_id: HexHash,
    buyer_address: ETH_ADDRESS.nullable(),
    seller_address: ETH_ADDRESS.nullable(),
    state: z.string().max(32),
    opened_block: z.number().int().nullable(),
    last_block: z.number().int().nullable(),
    opened_ts: z.number().int().nullable(),
    last_ts: z.number().int().nullable(),
    max_amount_usdc: z.number().finite().nullable(),
    settled_amount_usdc: z.number().finite().nullable(),
    total_delta_usdc: z.number().finite().nullable(),
    event_count: z.number().int().nonnegative(),
  })
  .passthrough();

export const SellersPageZ = z.object({
  sellers: z.array(SellerRowZ).max(1000),
  total: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
});

export const BuyersPageZ = z.object({
  buyers: z.array(BuyerRowZ).max(1000),
  total: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
});

export const ChannelsPageZ = z.object({
  channels: z.array(ChannelRowZ).max(1000),
  total: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
});

export const BuyerCreateSessionResponseZ = z
  .object({
    sessionId: z.string().max(256).optional(),
    channelAddress: ETH_ADDRESS.optional(),
    txHash: z.string().regex(/^0x[0-9a-fA-F]{1,128}$/).optional(),
    status: z.string().max(64).optional(),
  })
  .passthrough();

export const BuyerHealthZ = z
  .object({
    service: z.string().max(64).optional(),
    name: z.string().max(64).optional(),
    version: z.string().max(64).optional(),
  })
  .passthrough();

const SERVICE_NAME_RE = /^[A-Za-z0-9_.\-:/]+$/;

export const ServicePricingZ = z
  .object({
    inputUsdPerMillion: z.number().finite().nonnegative().optional(),
    outputUsdPerMillion: z.number().finite().nonnegative().optional(),
  })
  .passthrough();

export const DirectoryProviderRowZ = z
  .object({
    address: ETH_ADDRESS,
    displayName: z.string().max(200).nullable(),
    region: z.string().max(64).nullable(),
    services: z.array(z.string().max(64).regex(SERVICE_NAME_RE)).max(500),
    pricing: z.record(z.string().max(64), ServicePricingZ),
    sessionCount: z.number().int().nonnegative(),
    totalVolumeUsdc: z.number().finite().nonnegative(),
    ghostCount: z.number().int().nonnegative(),
    closedCount: z.number().int().nonnegative(),
    updatedAt: z.number().int().nullable(),
  })
  .passthrough();

export const ProvidersPageZ = z.object({
  providers: z.array(DirectoryProviderRowZ).max(1000),
  total: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
});

export const SellerServicesResponseZ = z
  .object({
    address: ETH_ADDRESS,
    displayName: z.string().max(200).nullable(),
    region: z.string().max(64).nullable(),
    services: z.array(z.string().max(64).regex(SERVICE_NAME_RE)).max(500),
    pricing: z.record(z.string().max(64), ServicePricingZ),
    updatedAt: z.number().int().nullable(),
  })
  .passthrough();

// /api/stats — shape returned by app/api/stats/route.ts (passthrough on
// optional fields so future explorer additions don't break clients).
export const NetworkStatsResponseZ = z
  .object({
    totalBuyers: z.number().int().nonnegative().optional(),
    qualifiedBuyers: z.number().int().nonnegative().optional(),
    totalVolumeUsdc: z.number().finite().nonnegative().optional(),
    totalSessions: z.number().int().nonnegative().optional(),
    totalGhosts: z.number().int().nonnegative().optional(),
    lastSyncTs: z.number().int().nullable().optional(),
    drift: z
      .object({
        eventsUsdc: z.number().finite().optional(),
        profilesUsdc: z.number().finite().optional(),
        driftUsdc: z.number().finite().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const GasResponseZ = z
  .object({
    // upstream returns a string like "0.4231" or null when fee estimation fails
    gwei: z.union([z.string().max(32), z.number(), z.null()]),
  })
  .passthrough();

// One row from /api/metrics/dau (granularity=day). Shape mirrors the explorer
// route in app/api/metrics/dau/route.ts.
export const DauDayRowZ = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    new: z.number().int().nonnegative(),
    existing: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    dau_buyers: z.number().int().nonnegative(),
    dau_sellers: z.number().int().nonnegative(),
  })
  .passthrough();

export const DauTrendResponseZ = z.array(DauDayRowZ).max(3_650);

// /api/buyers/[address]
export const BuyerMonthlyVolumeRowZ = z
  .object({
    month: z.string().max(16),
    sessions: z.number().int().nonnegative(),
    volume: z.number().finite(),
  })
  .passthrough();

export const BuyerSessionEventZ = z
  .object({
    tx_hash: z.string().max(128).nullable().optional(),
    block_number: z.number().int().nullable().optional(),
    event_type: z.string().max(32),
    seller_address: ETH_ADDRESS.nullable().optional(),
    channel_id: HexHash.nullable().optional(),
    delta_usdc: z.number().finite().nullable().optional(),
    settled_amount_usdc: z.number().finite().nullable().optional(),
    timestamp: z.number().int().nullable().optional(),
    seller_label: z.string().max(200).nullable().optional(),
  })
  .passthrough();

export const BuyerSellerSummaryRowZ = z
  .object({
    seller_address: ETH_ADDRESS,
    sessions: z.number().int().nonnegative(),
    total_usdc: z.number().finite().nonnegative(),
    seller_label: z.string().max(200).nullable().optional(),
  })
  .passthrough();

export const BuyerProfileResponseZ = z
  .object({
    profile: BuyerRowZ,
    sessions: z.array(BuyerSessionEventZ).max(200),
    topSellers: z.array(BuyerSellerSummaryRowZ).max(100),
    monthly: z.array(BuyerMonthlyVolumeRowZ).max(200),
  })
  .passthrough();

// /api/score/[address]
export const TrustScoreBreakdownZ = z
  .object({
    total: z.number().finite(),
    volume: z.number().finite(),
    consistency: z.number().finite(),
    diversity: z.number().finite(),
    reliability: z.number().finite(),
    qualified: z.boolean(),
  })
  .passthrough();

export const BuyerScoreResponseZ = z
  .object({
    address: ETH_ADDRESS,
    score: z.number().finite(),
    tier: z.string().max(32),
    qualified: z.boolean(),
    breakdown: TrustScoreBreakdownZ.nullable(),
  })
  .passthrough();

export type ServicePricing = z.infer<typeof ServicePricingZ>;
export type DirectoryProviderRow = z.infer<typeof DirectoryProviderRowZ>;
export type NetworkStatsResponse = z.infer<typeof NetworkStatsResponseZ>;
export type GasResponse = z.infer<typeof GasResponseZ>;
export type DauDayRow = z.infer<typeof DauDayRowZ>;
export type BuyerProfileResponse = z.infer<typeof BuyerProfileResponseZ>;
export type BuyerScoreResponse = z.infer<typeof BuyerScoreResponseZ>;
