import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const MAINNET_RPC = process.env.MAINNET_RPC_URL ?? "https://eth.drpc.org";

const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http(MAINNET_RPC, { timeout: 6_000, retryCount: 0 }),
});

interface CacheEntry {
  value: string | null;
  expires: number;
}

const nameCache = new Map<string, CacheEntry>();
const addrCache = new Map<string, CacheEntry>();

const TTL = 60 * 60 * 1000; // 1 hour

export async function getEnsName(address: string): Promise<string | null> {
  const key = address.toLowerCase();
  const hit = nameCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const name = await mainnetClient.getEnsName({ address: address as `0x${string}` });
    nameCache.set(key, { value: name ?? null, expires: Date.now() + TTL });
    return name ?? null;
  } catch {
    nameCache.set(key, { value: null, expires: Date.now() + TTL });
    return null;
  }
}

export async function resolveEnsName(name: string): Promise<string | null> {
  const key = name.toLowerCase();
  const hit = addrCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const addr = await mainnetClient.getEnsAddress({ name });
    const result = addr ?? null;
    addrCache.set(key, { value: result, expires: Date.now() + TTL });
    return result;
  } catch {
    addrCache.set(key, { value: null, expires: Date.now() + TTL });
    return null;
  }
}
