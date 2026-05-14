// AntSeed contract addresses (Base mainnet, chain id 8453).
// Source: https://antseed.com/docs/payments + Basescan verification.
// AntseedChannels deployment block from creation tx.

export const CONTRACTS = {
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  AntseedRegistry: "0xf33fC901BFa97326379A369401F4490E231B69B0",
  AntseedDeposits: "0x0F7a3a8f4Da01637d1202bb5443fcF7F88F99fD2",
  AntseedChannels: "0xBA66d3b4fbCf472F6F11D6F9F96aaCE96516F09d",
  AntseedStaking: "0x3652E6B22919bd322A25723B94BB207602E5c8e6",
  AntseedStats: "0x15649ff076BFa5e37e24EE3154a00503149954Fd",
  AntseedEmissions: "0x36877fBa8Fa333aa46a1c57b66D132E4995C86b5",
  ANTSToken: "0xa87EE81b2C0Bc659307ca2D9ffdC38514DD85263",
  IdentityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
} as const;

export const CHANNELS_DEPLOYMENT_BLOCK = 45_667_842n;
export const ANTSEED_STATS_DEPLOYMENT_BLOCK = 44_469_557n;

// Real ABI fragment, pulled from the verified contract on Basescan.
export const channelsAbi = [
  {
    type: "event",
    name: "Reserved",
    inputs: [
      { indexed: true, name: "channelId", type: "bytes32" },
      { indexed: true, name: "buyer", type: "address" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: false, name: "maxAmount", type: "uint128" },
    ],
  },
  {
    type: "event",
    name: "ChannelSettled",
    inputs: [
      { indexed: true, name: "channelId", type: "bytes32" },
      { indexed: true, name: "buyer", type: "address" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: false, name: "cumulativeAmount", type: "uint128" },
      { indexed: false, name: "delta", type: "uint128" },
      { indexed: false, name: "totalSettled", type: "uint128" },
      { indexed: false, name: "platformFee", type: "uint256" },
      { indexed: false, name: "metadata", type: "bytes" },
    ],
  },
  {
    type: "event",
    name: "ChannelClosed",
    inputs: [
      { indexed: true, name: "channelId", type: "bytes32" },
      { indexed: true, name: "buyer", type: "address" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: false, name: "settledAmount", type: "uint128" },
      { indexed: false, name: "refund", type: "uint128" },
    ],
  },
  {
    type: "event",
    name: "ChannelTopUp",
    inputs: [
      { indexed: true, name: "channelId", type: "bytes32" },
      { indexed: true, name: "buyer", type: "address" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: false, name: "additionalAmount", type: "uint128" },
      { indexed: false, name: "newDeposit", type: "uint128" },
    ],
  },
  {
    type: "event",
    name: "ChannelWithdrawn",
    inputs: [
      { indexed: true, name: "channelId", type: "bytes32" },
      { indexed: true, name: "buyer", type: "address" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: false, name: "refund", type: "uint128" },
    ],
  },
  {
    type: "event",
    name: "CloseRequested",
    inputs: [
      { indexed: true, name: "channelId", type: "bytes32" },
      { indexed: true, name: "buyer", type: "address" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: false, name: "gracePeriodEnd", type: "uint256" },
    ],
  },
] as const;

// View functions for the Read Contract UI (not used by the indexer).
export const channelsViewAbi = [
  {
    type: "function",
    name: "getChannel",
    stateMutability: "view",
    inputs: [{ name: "channelId", type: "bytes32" }],
    outputs: [
      { name: "buyer", type: "address" },
      { name: "seller", type: "address" },
      { name: "maxAmount", type: "uint128" },
      { name: "deposit", type: "uint128" },
      { name: "settled", type: "uint128" },
      { name: "state", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type EventType =
  | "reserved"
  | "settled"
  | "closed"
  | "topup"
  | "withdrawn"
  | "close_requested"
  | "metadata_recorded";

// AntseedStats — canonical token-usage event filled by authorized writers
// (whitelisted addresses calling recordMetadata). This is the source Dune
// uses for tokens-consumed; ChannelSettled.metadata is opaque seller bytes
// and unreliable for aggregation.
export const antseedStatsAbi = [
  {
    type: "event",
    name: "MetadataRecorded",
    inputs: [
      { indexed: true, name: "agentId", type: "uint256" },
      { indexed: true, name: "buyer", type: "address" },
      { indexed: true, name: "channelId", type: "bytes32" },
      { indexed: false, name: "metadataHash", type: "bytes32" },
      { indexed: false, name: "inputTokens", type: "uint256" },
      { indexed: false, name: "outputTokens", type: "uint256" },
      { indexed: false, name: "requestCount", type: "uint256" },
    ],
  },
] as const;
