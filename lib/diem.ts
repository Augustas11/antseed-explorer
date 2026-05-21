import { parseAbi, parseAbiItem } from "viem";
import { publicClient } from "./chain";

export const DIEM_TOKEN = "0xf4d97f2da56e8c3098f3a8d538db630a2606a024";
export const DIEM_STAKING_PROXY =
  "0x1f228613116e2d08014dfdcc198377c8dedf18c9" as `0x${string}`;
export const DIEM_STAKING_DEPLOYMENT_BLOCK = 45_265_606n;

const LOG_BATCH_SIZE = 9_000n;
const CACHE_TTL_MS = 10 * 60_000;
const ENUMERATE_POOL_USERS = process.env.DIEM_ENUMERATE_USERS === "1";

const diemStakingAbi = parseAbi([
  "function staked(address user) view returns (uint256)",
  "function stakerCount() view returns (uint32)",
]);
const stakedEvent = parseAbiItem(
  "event Staked(address indexed user, uint256 amount)",
);

export interface DiemPoolUserSnapshot {
  addresses: string[];
  count: number;
  exactAddresses: boolean;
}

let activeStakersCache:
  | { at: number; snapshot: DiemPoolUserSnapshot }
  | null = null;

function topicToAddress(topic: `0x${string}` | undefined): string | null {
  if (!topic || topic.length !== 66) return null;
  const addr = `0x${topic.slice(-40)}`.toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(addr) ? addr : null;
}

export async function getActiveDiemPoolUsers(): Promise<DiemPoolUserSnapshot> {
  const now = Date.now();
  if (activeStakersCache && now - activeStakersCache.at < CACHE_TTL_MS) {
    return activeStakersCache.snapshot;
  }

  // SSR is on the hot path here; the home page renders every request and
  // base.drpc.org has gone unresponsive in the past (~8s timeout + 1 retry =
  // up to 16s before this returns), which pushes past Vercel's function
  // timeout and takes the whole homepage down. Treat RPC failure as a soft
  // miss instead.
  let stakerCount: number;
  try {
    stakerCount = Number(
      await publicClient.readContract({
        address: DIEM_STAKING_PROXY,
        abi: diemStakingAbi,
        functionName: "stakerCount",
      }),
    );
  } catch (e: any) {
    console.warn("[diem] stakerCount RPC failed; using fallback", e?.message ?? e);
    if (activeStakersCache) return activeStakersCache.snapshot;
    const snapshot = { addresses: [], count: 0, exactAddresses: false };
    // Re-try in ~60s rather than the full 10min TTL so a flapping RPC recovers fast.
    activeStakersCache = { at: now - (CACHE_TTL_MS - 60_000), snapshot };
    return snapshot;
  }

  if (!ENUMERATE_POOL_USERS) {
    const snapshot = {
      addresses: [],
      count: stakerCount,
      exactAddresses: false,
    };
    activeStakersCache = { at: now, snapshot };
    return snapshot;
  }

  try {
    const head = await publicClient.getBlockNumber();
    const stakers = new Set<string>();

    for (
      let fromBlock = DIEM_STAKING_DEPLOYMENT_BLOCK;
      fromBlock <= head;
      fromBlock += LOG_BATCH_SIZE
    ) {
      const toBlock =
        fromBlock + LOG_BATCH_SIZE - 1n > head
          ? head
          : fromBlock + LOG_BATCH_SIZE - 1n;
      const logs = await publicClient.getLogs({
        address: DIEM_STAKING_PROXY,
        fromBlock,
        toBlock,
        event: stakedEvent,
      });
      for (const log of logs) {
        const addr = topicToAddress(log.topics[1]);
        if (addr) stakers.add(addr);
      }
    }

    const candidates = [...stakers];
    const active: string[] = [];
    for (let i = 0; i < candidates.length; i += 100) {
      const chunk = candidates.slice(i, i + 100);
      const balances = (await publicClient.multicall({
        allowFailure: true,
        contracts: chunk.map((user) => ({
          address: DIEM_STAKING_PROXY,
          abi: diemStakingAbi,
          functionName: "staked",
          args: [user as `0x${string}`],
        })),
      })) as Array<{ status: string; result?: unknown }>;
      balances.forEach((r, idx) => {
        if (
          r.status === "success" &&
          typeof r.result === "bigint" &&
          r.result > 0n
        ) {
          active.push(chunk[idx]);
        }
      });
    }

    const snapshot = {
      addresses: active,
      count: active.length,
      exactAddresses: true,
    };
    activeStakersCache = { at: now, snapshot };
    return snapshot;
  } catch (e: any) {
    console.warn(
      "[diem] failed to enumerate pool users; using stakerCount",
      e?.message ?? e,
    );
    const snapshot = {
      addresses: [],
      count: stakerCount,
      exactAddresses: false,
    };
    activeStakersCache = { at: now, snapshot };
    return snapshot;
  }
}

export async function listActiveDiemPoolUsers(): Promise<string[]> {
  return (await getActiveDiemPoolUsers()).addresses;
}
