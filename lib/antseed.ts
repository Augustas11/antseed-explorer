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
  AntseedEmissionsV1: "0x36877fBa8Fa333aa46a1c57b66D132E4995C86b5",
  AntseedEmissions: "0xF13bE52c4A3afC6AE29536f073588d01A0564088", // V2, current
  ANTSToken: "0xa87EE81b2C0Bc659307ca2D9ffdC38514DD85263",
  IdentityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
} as const;

export const CHANNELS_DEPLOYMENT_BLOCK = 45_667_842n;
export const ANTSEED_STATS_DEPLOYMENT_BLOCK = 44_469_557n;
export const ANTS_TOKEN_DEPLOYMENT_BLOCK = 44_469_557n;
export const EMISSIONS_DEPLOYMENT_BLOCK = 45_937_736n;

// Addresses that hold $ANT as part of protocol mechanics, not as end-users.
// Excluded from the "$ANT holders" headcount that feeds Paying Users.
export const ANTS_NON_USER_ADDRESSES: readonly string[] = [
  "0x0000000000000000000000000000000000000000",
  "0xa87ee81b2c0bc659307ca2d9ffdc38514dd85263", // ANTS token self
  "0xf13be52c4a3afc6ae29536f073588d01a0564088", // AntseedEmissions V2
  "0x36877fba8fa333aa46a1c57b66d132e4995c86b5", // AntseedEmissions V1
  "0x3652e6b22919bd322a25723b94bb207602e5c8e6", // AntseedStaking
  "0x0f7a3a8f4da01637d1202bb5443fcf7f88f99fd2", // AntseedDeposits
  "0xf33fc901bfa97326379a369401f4490e231b69b0", // AntseedRegistry
  "0x15649ff076bfa5e37e24ee3154a00503149954fd", // AntseedStats
];

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
  | "metadata_recorded"
  | "ants_claim";

// ERC-20 Transfer on the ANTS token. Indexed for the live-balance table
// that powers the "$ANT holders" headcount. Individual transfers aren't
// persisted; only the running per-address balance.
export const antsTokenAbi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
] as const;

// AntseedEmissionsV2 — fires for both claimBuyerEmissions and
// claimSellerEmissions. `account` is the caller, `recipient` is where the
// $ANT lands (often the same address).
export const emissionsAbi = [
  {
    type: "event",
    name: "EmissionsClaimed",
    inputs: [
      { indexed: true, name: "account", type: "address" },
      { indexed: true, name: "recipient", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "epochs", type: "uint256[]" },
    ],
  },
] as const;

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
