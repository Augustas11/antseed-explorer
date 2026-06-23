import { createPublicClient, defineChain, http } from "viem";

const base = defineChain({
  id: 8453,
  name: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://mainnet.base.org"] },
  },
  blockExplorers: {
    default: {
      name: "Basescan",
      url: "https://basescan.org",
      apiUrl: "https://api.basescan.org/api",
    },
  },
  contracts: {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11",
      blockCreated: 5022,
    },
  },
});

const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://sepolia.base.org"] },
  },
  blockExplorers: {
    default: {
      name: "Basescan",
      url: "https://sepolia.basescan.org",
      apiUrl: "https://api-sepolia.basescan.org/api",
    },
  },
  contracts: {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11",
      blockCreated: 1059647,
    },
  },
  testnet: true,
});

const RPC_URL = process.env.RPC_URL || "https://base.drpc.org";
const CHAIN_ID = Number(process.env.CHAIN_ID || 8453);

export const chain = CHAIN_ID === 84532 ? baseSepolia : base;

// 20 s timeout + 1 retry = 40 s max per RPC call. Sized for archive-depth
// eth_getLogs over paid dRPC — 8 s was tight enough that once channels fell
// behind a day, every batch hit the timeout and the indexer stranded itself
// (a single hairy archive query can take 2-15 s depending on log density).
// Channels' deadline is 45 s and Vercel's function ceiling is 60 s, so 20 s
// still leaves room for the per-batch Neon writes + cursor flush before the
// next iteration's deadline check. Override via env for one-shot scripts.
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 20_000);
export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { timeout: RPC_TIMEOUT_MS, retryCount: 1 }),
});

export function createPublicClientWithTimeout(
  timeoutMs: number,
  retryCount = 0,
): typeof publicClient {
  return createPublicClient({
    chain,
    transport: http(RPC_URL, { timeout: timeoutMs, retryCount }),
  }) as typeof publicClient;
}

export const explorerBaseUrl =
  CHAIN_ID === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org";
