import { parseAbi, parseAbiItem } from "viem";
import { publicClient } from "./chain";
import { getState, setState } from "./db";

export const DIEM_TOKEN = "0xf4d97f2da56e8c3098f3a8d538db630a2606a024";
export const DIEM_STAKING_PROXY =
  "0x1f228613116e2d08014dfdcc198377c8dedf18c9" as `0x${string}`;
export const DIEM_STAKING_DEPLOYMENT_BLOCK = 45_265_606n;

const LOG_BATCH_SIZE = 9_000n;
const CACHE_TTL_MS = 10 * 60_000;
// DB-cached snapshot is acceptable up to this age on the SSR hot path. Cron
// refreshes every 5min, so 30min covers a few missed ticks before we'd rather
// fall back to live RPC than serve stale numbers.
const DB_SNAPSHOT_MAX_AGE_MS = 30 * 60_000;
const DIEM_SNAPSHOT_KEY = "diem_pool_snapshot";
const ENUMERATE_POOL_USERS = process.env.DIEM_ENUMERATE_USERS === "1";
const DEADLINE_GUARD_MS = 500;

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

// Per-process memo only; the persisted indexer_state snapshot is the
// cross-instance source of truth for serverless/runtime restarts.
let activeStakersCache:
  | { at: number; snapshot: DiemPoolUserSnapshot }
  | null = null;

// Coalesce concurrent callers within one process onto a single inflight
// promise so we never do two RPCs in parallel for the same snapshot.
let inflight: Promise<DiemPoolUserSnapshot> | null = null;

function topicToAddress(topic: `0x${string}` | undefined): string | null {
  if (!topic || topic.length !== 66) return null;
  const addr = `0x${topic.slice(-40)}`.toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(addr) ? addr : null;
}

interface PersistedDiemSnapshot {
  at: number;
  snapshot: DiemPoolUserSnapshot;
}

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

export function sanitizeDiemPoolSnapshot(
  value: unknown,
): DiemPoolUserSnapshot | null {
  const snapshot = value as Partial<DiemPoolUserSnapshot>;
  if (!snapshot || typeof snapshot !== "object") return null;
  if (
    typeof snapshot.count !== "number" ||
    !Number.isSafeInteger(snapshot.count) ||
    snapshot.count < 0 ||
    !Array.isArray(snapshot.addresses)
  ) {
    return null;
  }

  const addresses = Array.from(
    new Set(
      snapshot.addresses
        .filter((address): address is string => typeof address === "string")
        .map((address) => address.toLowerCase())
        .filter((address) => ADDRESS_RE.test(address)),
    ),
  );
  const exactAddresses = snapshot.exactAddresses === true;
  return {
    addresses: exactAddresses ? addresses : [],
    count: exactAddresses ? addresses.length : snapshot.count,
    exactAddresses,
  };
}

async function readDbSnapshot(): Promise<PersistedDiemSnapshot | null> {
  try {
    const raw = await getState(DIEM_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDiemSnapshot;
    if (typeof parsed?.at !== "number" || !Number.isFinite(parsed.at)) return null;
    const snapshot = sanitizeDiemPoolSnapshot(parsed.snapshot);
    if (!snapshot) return null;
    return { at: parsed.at, snapshot };
  } catch (e: any) {
    console.warn("[diem] failed to read DB snapshot", e?.message ?? e);
    return null;
  }
}

async function writeDbSnapshot(snapshot: DiemPoolUserSnapshot, at: number) {
  try {
    await setState(
      DIEM_SNAPSHOT_KEY,
      JSON.stringify({ at, snapshot } satisfies PersistedDiemSnapshot),
    );
  } catch (e: any) {
    console.warn("[diem] failed to persist DB snapshot", e?.message ?? e);
  }
}

interface FetchLiveSnapshotOptions {
  deadlineMs?: number;
  countOnly?: boolean;
}

function hasDeadline(startedAt: number, deadlineMs: number | undefined): boolean {
  return deadlineMs == null || Date.now() - startedAt < deadlineMs - DEADLINE_GUARD_MS;
}

// Live RPC path — only used by the cron refresher and as a one-time bootstrap
// when the DB snapshot is missing. SSR callers never run the unbounded
// enumeration branch.
async function fetchLiveSnapshot(
  opts: FetchLiveSnapshotOptions = {},
): Promise<DiemPoolUserSnapshot | null> {
  const startedAt = Date.now();
  let stakerCount: number;
  try {
    if (!hasDeadline(startedAt, opts.deadlineMs)) return null;
    stakerCount = Number(
      await publicClient.readContract({
        address: DIEM_STAKING_PROXY,
        abi: diemStakingAbi,
        functionName: "stakerCount",
      }),
    );
  } catch (e: any) {
    console.warn("[diem] stakerCount RPC failed", e?.message ?? e);
    return null;
  }

  if (opts.countOnly || !ENUMERATE_POOL_USERS) {
    return { addresses: [], count: stakerCount, exactAddresses: false };
  }

  try {
    if (!hasDeadline(startedAt, opts.deadlineMs)) {
      return { addresses: [], count: stakerCount, exactAddresses: false };
    }
    const head = await publicClient.getBlockNumber();
    const stakers = new Set<string>();

    for (
      let fromBlock = DIEM_STAKING_DEPLOYMENT_BLOCK;
      fromBlock <= head;
      fromBlock += LOG_BATCH_SIZE
    ) {
      if (!hasDeadline(startedAt, opts.deadlineMs)) {
        return { addresses: [], count: stakerCount, exactAddresses: false };
      }
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
      if (!hasDeadline(startedAt, opts.deadlineMs)) {
        return { addresses: [], count: stakerCount, exactAddresses: false };
      }
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

    return {
      addresses: active,
      count: active.length,
      exactAddresses: true,
    };
  } catch (e: any) {
    console.warn(
      "[diem] failed to enumerate pool users; using stakerCount",
      e?.message ?? e,
    );
    return { addresses: [], count: stakerCount, exactAddresses: false };
  }
}

// Refresh the persisted DIEM snapshot. Called from the 5-min cron so the SSR
// hot path never has to do an RPC. Safe to call ad-hoc; idempotent.
export async function refreshDiemPoolSnapshot(
  opts: { deadlineMs?: number } = {},
): Promise<DiemPoolUserSnapshot | null> {
  const snapshot = await fetchLiveSnapshot(opts);
  if (!snapshot) return null;
  const now = Date.now();
  await writeDbSnapshot(snapshot, now);
  activeStakersCache = { at: now, snapshot };
  return snapshot;
}

export async function getActiveDiemPoolUsers(): Promise<DiemPoolUserSnapshot> {
  const now = Date.now();
  if (activeStakersCache && now - activeStakersCache.at < CACHE_TTL_MS) {
    return activeStakersCache.snapshot;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    // Hot-path read: persisted snapshot from indexer_state, refreshed every
    // 5min by /api/cron/sync. One fast Neon HTTP query, no Base RPC.
    const persisted = await readDbSnapshot();
    if (persisted && now - persisted.at < DB_SNAPSHOT_MAX_AGE_MS) {
      activeStakersCache = { at: now, snapshot: persisted.snapshot };
      return persisted.snapshot;
    }

    if (persisted) {
      // Stale snapshot: serve bounded data immediately. The cron refresher is
      // the only path allowed to run event-log enumeration.
      activeStakersCache = { at: now, snapshot: persisted.snapshot };
      return persisted.snapshot;
    }
    if (activeStakersCache) return activeStakersCache.snapshot;

    // Bootstrap with no DB snapshot: only allow the cheap stakerCount call.
    // This prevents a cold SSR render from walking the staking event history.
    const live = await fetchLiveSnapshot({ countOnly: true, deadlineMs: 2_000 });
    if (live) {
      await writeDbSnapshot(live, now);
      activeStakersCache = { at: now, snapshot: live };
      return live;
    }

    const empty: DiemPoolUserSnapshot = {
      addresses: [],
      count: 0,
      exactAddresses: false,
    };
    // Short-TTL the empty result so a flapping RPC recovers in ~60s rather
    // than the full 10min cache window.
    activeStakersCache = { at: now - (CACHE_TTL_MS - 60_000), snapshot: empty };
    return empty;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export async function listActiveDiemPoolUsers(): Promise<string[]> {
  return (await getActiveDiemPoolUsers()).addresses;
}
