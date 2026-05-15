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

export const lookupSchema = z.object({
  query: z.string().min(1).max(256, "query is too long"),
  limit: z.number().int().min(1).max(100).default(10),
});

export const listProvidersSchema = z.object({
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(1000).default(20),
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

export type LookupInput = z.infer<typeof lookupSchema>;
export type ListProvidersInput = z.infer<typeof listProvidersSchema>;
export type GetPricingInput = z.infer<typeof getPricingSchema>;
export type GetSessionStatusInput = z.infer<typeof getSessionStatusSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

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

export type ServicePricing = z.infer<typeof ServicePricingZ>;
export type DirectoryProviderRow = z.infer<typeof DirectoryProviderRowZ>;
