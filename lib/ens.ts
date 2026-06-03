import { createPublicClient, defineChain, http } from "viem";

const mainnet = defineChain({
  id: 1,
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://eth.merkle.io"] },
  },
  blockExplorers: {
    default: {
      name: "Etherscan",
      url: "https://etherscan.io",
      apiUrl: "https://api.etherscan.io/api",
    },
  },
  contracts: {
    ensUniversalResolver: {
      address: "0xeeeeeeee14d718c2b47d9923deab1335e144eeee",
      blockCreated: 23085558,
    },
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11",
      blockCreated: 14353601,
    },
  },
});

const MAINNET_RPC = process.env.MAINNET_RPC_URL ?? "https://eth.drpc.org";

const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http(MAINNET_RPC, { timeout: 6_000, retryCount: 0 }),
});

interface CacheEntry {
  value: string | null;
  expires: number;
}

const TTL = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_ENTRIES = 1_000;

// Per-process best-effort caches only; serverless instances do not share them.
// Misses are harmless and re-resolve through mainnet RPC.
const nameCache = new Map<string, CacheEntry>();
const addrCache = new Map<string, CacheEntry>();

function getCached(cache: Map<string, CacheEntry>, key: string): string | null | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function setCached(cache: Map<string, CacheEntry>, key: string, value: string | null) {
  const now = Date.now();
  cache.set(key, { value, expires: now + TTL });
  for (const [entryKey, entry] of cache) {
    if (entry.expires <= now) cache.delete(entryKey);
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export async function getEnsName(address: string): Promise<string | null> {
  const key = address.toLowerCase();
  const hit = getCached(nameCache, key);
  if (hit !== undefined) return hit;
  try {
    const name = await mainnetClient.getEnsName({ address: address as `0x${string}` });
    setCached(nameCache, key, name ?? null);
    return name ?? null;
  } catch {
    setCached(nameCache, key, null);
    return null;
  }
}

export async function resolveEnsName(name: string): Promise<string | null> {
  const key = name.toLowerCase();
  const hit = getCached(addrCache, key);
  if (hit !== undefined) return hit;
  try {
    const addr = await mainnetClient.getEnsAddress({ name });
    const result = addr ?? null;
    setCached(addrCache, key, result);
    return result;
  } catch {
    setCached(addrCache, key, null);
    return null;
  }
}
