import { publicClient } from "./chain";
import {
  CONTRACTS,
  CHANNELS_DEPLOYMENT_BLOCK,
  ANTSEED_STATS_DEPLOYMENT_BLOCK,
  ANTS_TOKEN_DEPLOYMENT_BLOCK,
  EMISSIONS_DEPLOYMENT_BLOCK,
  ANTSEED_DEPOSITS_DEPLOYMENT_BLOCK,
  ANTSEED_STAKING_DEPLOYMENT_BLOCK,
  IDENTITY_REGISTRY_DEPLOYMENT_BLOCK,
  channelsAbi,
  antseedStatsAbi,
  antsTokenAbi,
  emissionsAbi,
  stakingAbi,
  depositsAbi,
  identityRegistryAbi,
  type EventType,
} from "./antseed";
import { db, getState, setState, tryAcquireSyncLock, releaseSyncLock } from "./db";
import { events as eventsTbl, buyerProfiles, providerDirectory, antsHolderDeltas } from "./schema";
import { sql } from "drizzle-orm";
import { calculateTrustScore } from "./score";
import { rawAddressList, rawDateLiteral } from "./sqlSafe";
import {
  estimateBlockTimestamps,
  syncEventStream,
} from "./indexerWindow";

export { growLogBatchSize, shrinkLogBatchSize } from "./indexerWindow";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const ENV_BATCH_SIZE = BigInt(process.env.LOG_BATCH_SIZE || 2000);
const SYNC_DEBOUNCE_MS = 60_000;
const USDC_DECIMALS_BIGINT = 1_000_000n;
const MAX_SAFE_USDC_ATOMS = BigInt(Number.MAX_SAFE_INTEGER) * USDC_DECIMALS_BIGINT;
const PROVIDER_REFRESH_MS = 60 * 60 * 1000; // 1h
const PROVIDER_FETCH_TIMEOUT_MS = 5_000;
const PROVIDER_DIRECTORY_MAX_BODY_BYTES = 1_000_000;
const PENDING_BUYERS_KEY = "buyers_recompute_pending";

const channelsAddress = (process.env.CHANNELS_ADDRESS ||
  CONTRACTS.AntseedChannels) as `0x${string}`;

const startBlockEnv = process.env.START_BLOCK
  ? BigInt(process.env.START_BLOCK)
  : CHANNELS_DEPLOYMENT_BLOCK;

function usdcAtomsToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== "bigint") return null;
  if (value < 0n || value > MAX_SAFE_USDC_ATOMS) return null;
  return Number(value) / Number(USDC_DECIMALS_BIGINT);
}

interface SyncResult {
  ok: boolean;
  fromBlock: string;
  toBlock: string;
  eventsAdded: number;
  buyersTouched: number;
  skipped?: string;
  error?: string;
}

export async function shouldSync(): Promise<boolean> {
  const last = await getState("last_sync_ts");
  if (!last) return true;
  return Date.now() - Number(last) > SYNC_DEBOUNCE_MS;
}

async function getPendingBuyers(): Promise<string[]> {
  const raw = await getState(PENDING_BUYERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a): a is string => typeof a === "string" && /^0x[0-9a-f]{40}$/.test(a))
      .map((a) => a.toLowerCase());
  } catch {
    return [];
  }
}

async function addPendingBuyers(addresses: Iterable<string>) {
  const next = new Set(await getPendingBuyers());
  for (const a of addresses) {
    const lc = a.toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(lc)) next.add(lc);
  }
  await setState(PENDING_BUYERS_KEY, JSON.stringify([...next]));
}

async function recomputePendingBuyers(extra: Iterable<string> = []) {
  const addresses = new Set(await getPendingBuyers());
  for (const a of extra) {
    const lc = a.toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(lc)) addresses.add(lc);
  }
  if (addresses.size === 0) return;
  await recomputeBuyers([...addresses]);
  await setState(PENDING_BUYERS_KEY, "[]");
}

export async function sync(opts: { force?: boolean; deadlineMs?: number } = {}): Promise<SyncResult> {
  if (!opts.force && !(await shouldSync())) {
    const pending = await getPendingBuyers();
    if (pending.length === 0) {
      const last = await getState("last_indexed_block");
      return {
        ok: true,
        fromBlock: last || "0",
        toBlock: last || "0",
        eventsAdded: 0,
        buyersTouched: 0,
        skipped: "debounced",
      };
    }
  }

  // Concurrency lock — cron + manual sync can fire simultaneously, and Neon
  // HTTP is connectionless so two passes can race on `last_indexed_block`.
  // Stale-after exceeds the 60s deadline so a killed instance recovers.
  const lockOwner = await tryAcquireSyncLock(90_000);
  if (!lockOwner) {
    const last = await getState("last_indexed_block");
    return {
      ok: true,
      fromBlock: last || "0",
      toBlock: last || "0",
      eventsAdded: 0,
      buyersTouched: 0,
      skipped: "locked",
    };
  }

  const syncStart = Date.now();
  try {
    let channels: SyncResult;
    try {
      channels = await runSync(opts);
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      console.warn("[indexer] channels sync failed:", msg);
      const last = await getState("last_indexed_block").catch(() => null);
      channels = {
        ok: false,
        fromBlock: last || "?",
        toBlock: last || "?",
        eventsAdded: 0,
        buyersTouched: 0,
        error: msg,
      };
    }
    const cronBudgetMs = opts.deadlineMs ?? 50_000;
    const remaining = (headroomMs = 3_000) =>
      cronBudgetMs - (Date.now() - syncStart) - headroomMs;
    const runAux = async <T extends { ok: boolean; error?: string }>(
      label: string,
      minMs: number,
      deadlineMs: number,
      fn: (opts: { deadlineMs: number }) => Promise<T>,
    ) => {
      if (deadlineMs < minMs) {
        console.warn(`[indexer] ${label} sync skipped: insufficient budget`);
        return;
      }
      try {
        const r = await fn({ deadlineMs });
        if (!r.ok) console.warn(`[indexer] ${label} sync failed:`, r.error || "unknown");
      } catch (e) {
        console.warn(`[indexer] ${label} sync failed:`, (e as Error)?.message || e);
      }
    };

    await runAux("antseed_stats", 5_000, remaining(15_000), syncAntseedStats);
    await runAux("ants_token", 3_000, Math.floor(remaining(9_000) / 2), syncAntsToken);
    await runAux("emissions", 2_000, Math.floor(remaining(7_000) / 3), syncEmissions);
    await runAux("staking", 2_000, Math.floor(remaining(5_000) / 2), syncStaking);
    await runAux("antseed_deposits", 2_000, Math.floor(remaining(4_000) / 2), syncAntseedDeposits);

    // Provider directory must refresh before identity filtering, otherwise a
    // newly discovered provider can have historical identity rows skipped.
    if (remaining(8_000) >= PROVIDER_FETCH_TIMEOUT_MS) {
      await refreshProviderDirectory();
    } else {
      console.warn("[indexer] provider directory refresh skipped: insufficient budget");
    }
    await runAux("identity_registry", 2_000, remaining(3_000), syncIdentityRegistry);

    // Daily DAU pre-aggregate refresh. The closed-day buckets are immutable;
    // we just need to keep "today" and "yesterday" warm. Backfill of older
    // days is done once by scripts/_backfill-deposits.ts.
    try {
      await recomputeDailyDauRecent(2);
    } catch (e) {
      console.warn("[indexer] daily_dau recompute failed:", (e as Error)?.message || e);
    }
    return channels;
  } finally {
    try {
      await releaseSyncLock(lockOwner);
    } catch (e) {
      console.warn("[indexer] sync lock release failed:", (e as Error)?.message || e);
    }
    // Stamp last_sync_ts even on partial/error runs so the dashboard "Updated X ago"
    // dot reflects when the indexer last ran, not just when it last fully succeeded.
    // runSync already writes this on success paths; this catches early-return errors.
    try {
      await setState("last_sync_ts", Date.now().toString());
    } catch (e) {
      console.warn("[indexer] last_sync_ts update failed:", (e as Error)?.message || e);
    }
  }
}

async function runSync(opts: { deadlineMs?: number }): Promise<SyncResult> {
  const lastIndexedStr = await getState("last_indexed_block");
  const lastIndexed = BigInt(
    lastIndexedStr || (startBlockEnv - 1n).toString(),
  );

  let head: bigint;
  try {
    head = await publicClient.getBlockNumber();
  } catch (e: any) {
    return {
      ok: false,
      fromBlock: "?",
      toBlock: "?",
      eventsAdded: 0,
      buyersTouched: 0,
      error: e?.message || String(e),
    };
  }

  let fromBlock = lastIndexed + 1n;
  if (fromBlock > head) {
    await recomputePendingBuyers();
    await setState("last_sync_ts", Date.now().toString());
    return {
      ok: true,
      fromBlock: fromBlock.toString(),
      toBlock: head.toString(),
      eventsAdded: 0,
      buyersTouched: 0,
      skipped: "caught up",
    };
  }

  const buyersTouched = new Set<string>();
  const unknownEventNames = new Set<string>();
  let eventsAdded = 0;
  const persisted = await getState("log_batch_size");
  const batchSize = persisted ? BigInt(persisted) : ENV_BATCH_SIZE;
  // Default deadline; cron callers may override (Vercel Pro = 60s).
  const SOFT_DEADLINE_MS = opts.deadlineMs ?? 25_000;
  const startedAt = Date.now();
  const stream = await syncEventStream({
    fromBlockStart: fromBlock,
    head,
    initialBatchSize: batchSize,
    maxBatchSize: ENV_BATCH_SIZE,
    cursorKey: "last_indexed_block",
    batchKey: "log_batch_size",
    deadlineMs: SOFT_DEADLINE_MS,
    startedAt,
    sleepMs: 300,
    getLogs: (fromBlock, toBlock) =>
      publicClient.getLogs({
        address: channelsAddress,
        events: channelsAbi as any,
        fromBlock,
        toBlock,
      }),
    onLogs: async ({ from, logs, to }) => {
    // One anchor block timestamp per batch keeps Alchemy CU/sec load low;
    // Base's ~2s block time is accurate enough for "X ago" display.
    const blockTs = await estimateBlockTimestamps({
      logs,
      blockSeconds: 2,
      rateLimitBackoffMs: 2000,
      getBlockTimestamp: async (blockNumber) =>
        (await publicClient.getBlock({ blockNumber })).timestamp,
    });

    const rows: any[] = [];
    const batchBuyers = new Set<string>();
    let malformedMetadata = 0;
    for (const log of logs as any[]) {
      const eventType = mapEventType(log.eventName);
      if (!eventType) {
        unknownEventNames.add(log.eventName ?? "(undefined)");
        continue;
      }
      const args = log.args || {};
      const buyer = (args.buyer as string | undefined)?.toLowerCase() ?? null;
      const seller = (args.seller as string | undefined)?.toLowerCase() ?? null;
      const channelId = (args.channelId as string | undefined) ?? null;
      const ts = blockTs.get(log.blockNumber!) ?? 0;
      const meta = decodeMetadata(args.metadata);
      if (eventType === "settled" && args.metadata && !meta) malformedMetadata++;
      rows.push({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: Number(log.blockNumber),
        eventType,
        buyerAddress: buyer,
        sellerAddress: seller,
        channelId,
        maxAmountUsdc:
          usdcAtomsToNumber(args.maxAmount) ??
          usdcAtomsToNumber(args.additionalAmount),
        deltaUsdc: usdcAtomsToNumber(args.delta),
        refundUsdc: usdcAtomsToNumber(args.refund),
        settledAmountUsdc:
          usdcAtomsToNumber(args.settledAmount) ??
          usdcAtomsToNumber(args.totalSettled),
        cumulativeAmountUsdc: args.cumulativeAmount
          ? usdcAtomsToNumber(args.cumulativeAmount)
          : null,
        platformFeeUsdc: args.platformFee
          ? usdcAtomsToNumber(args.platformFee)
          : null,
        newDepositUsdc: args.newDeposit
          ? usdcAtomsToNumber(args.newDeposit)
          : null,
        gracePeriodEnd: args.gracePeriodEnd
          ? Number(args.gracePeriodEnd)
          : null,
        inputTokens: meta?.inputTokens ?? null,
        outputTokens: meta?.outputTokens ?? null,
        requestCount: meta?.requestCount ?? null,
        timestamp: ts,
        rawLog: JSON.stringify(serializableLog(log)),
      });
      if (buyer) {
        buyersTouched.add(buyer);
        batchBuyers.add(buyer);
      }
    }
    if (malformedMetadata > 0) {
      console.warn(
        `[indexer] ignored malformed ChannelSettled.metadata in ${malformedMetadata} logs for ${from}..${to}`,
      );
    }

    if (rows.length > 0) {
      const result = await db
        .insert(eventsTbl)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: eventsTbl.id });
      eventsAdded += result.length;
      await addPendingBuyers(batchBuyers);
    }
    },
  });

  if (!stream.ok) {
    return {
      ok: false,
      fromBlock: stream.fromBlock,
      toBlock: stream.toBlock,
      eventsAdded,
      buyersTouched: buyersTouched.size,
      error: stream.error,
    };
  }

  if (stream.error === "deadline_partial") {
    await recomputePendingBuyers(buyersTouched);
    await setState("last_sync_ts", Date.now().toString());
    return {
      ok: true,
      fromBlock: fromBlock.toString(),
      toBlock: stream.toBlock,
      eventsAdded,
      buyersTouched: buyersTouched.size,
      skipped: "deadline_partial",
    };
  }

  if (unknownEventNames.size > 0) {
    console.warn("[indexer] unknown event types skipped:", [...unknownEventNames].join(", "));
  }
  await recomputePendingBuyers(buyersTouched);
  // Cap the reconcile pass so it can't eat the whole tick — it's resumable
  // and converges across cron runs, and the auxiliary syncs in sync() still
  // need budget after runSync returns. Skip entirely if we're already over
  // the channels deadline (a busy backfill tick); the next tick reconciles.
  const reconcileBudget = SOFT_DEADLINE_MS - (Date.now() - startedAt) - 5_000;
  if (reconcileBudget >= 2_000) {
    await reconcileDrift({ deadlineMs: Math.min(15_000, reconcileBudget) });
  }
  await setState("last_sync_ts", Date.now().toString());
  await setState("last_head_block", head.toString());

  return {
    ok: true,
    fromBlock: fromBlock.toString(),
    toBlock: head.toString(),
    eventsAdded,
    buyersTouched: buyersTouched.size,
  };
}

const MAX_SAFE_TOKEN_COUNT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_SAFE_REQUEST_COUNT = 2_147_483_647n;
const CHANNEL_METADATA_VERSION = 1;

// ChannelSettled.metadata is abi-encoded as 4 uint256s:
//   [version, totalInputTokens, totalOutputTokens, totalRequests]
export function decodeMetadata(metadata: string | undefined):
  | { version: number; inputTokens: number; outputTokens: number; requestCount: number }
  | null {
  if (!metadata || typeof metadata !== "string") return null;
  const hex = metadata.startsWith("0x") ? metadata.slice(2) : metadata;
  if (hex.length < 64 * 4 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const word = (i: number) => BigInt("0x" + hex.slice(i * 64, (i + 1) * 64));
  const safeNumber = (value: bigint, max: bigint) =>
    value >= 0n && value <= max ? Number(value) : null;
  try {
    const version = safeNumber(word(0), 255n);
    const inputTokens = safeNumber(word(1), MAX_SAFE_TOKEN_COUNT);
    const outputTokens = safeNumber(word(2), MAX_SAFE_TOKEN_COUNT);
    const requestCount = safeNumber(word(3), MAX_SAFE_REQUEST_COUNT);
    if (
      version !== CHANNEL_METADATA_VERSION ||
      inputTokens == null ||
      outputTokens == null ||
      requestCount == null
    ) {
      return null;
    }
    return {
      version,
      inputTokens,
      outputTokens,
      requestCount,
    };
  } catch {
    return null;
  }
}

async function recomputeAntsHolderRows(addresses: Iterable<string>) {
  const safe = [...new Set([...addresses].map((a) => a.toLowerCase()))]
    .filter((a) => /^0x[0-9a-f]{40}$/.test(a));
  if (safe.length === 0) return;
  const now = Date.now();
  await db.execute(sql`
    INSERT INTO ants_holders (
      address,
      balance,
      staked_balance,
      first_seen_block,
      last_seen_block,
      updated_at
    )
    SELECT
      address,
      GREATEST(COALESCE(SUM(balance_delta), 0), 0),
      GREATEST(COALESCE(SUM(staked_delta), 0), 0),
      MIN(block_number)::bigint,
      MAX(block_number)::bigint,
      ${now}
    FROM ants_holder_deltas
    WHERE address IN (${rawAddressList(safe, "ANTS holder recompute addresses")})
    GROUP BY address
    ON CONFLICT (address) DO UPDATE SET
      balance = EXCLUDED.balance,
      staked_balance = EXCLUDED.staked_balance,
      first_seen_block = EXCLUDED.first_seen_block,
      last_seen_block = EXCLUDED.last_seen_block,
      updated_at = EXCLUDED.updated_at
  `);
}

export function mapEventType(name: string | undefined): EventType | null {
  switch (name) {
    case "Reserved": return "reserved";
    case "ChannelSettled": return "settled";
    case "ChannelClosed": return "closed";
    case "ChannelTopUp": return "topup";
    case "ChannelWithdrawn": return "withdrawn";
    case "CloseRequested": return "close_requested";
    case "Deposited": return "deposited";
    case "WithdrawalExecuted": return "withdrawal_executed";
    default: return null;
  }
}

function serializableLog(log: any) {
  return JSON.parse(
    JSON.stringify(log, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

// JSON.stringify a serializable log object, then if the result exceeds
// `maxBytes` rewrite oversize string/array fields under args with a
// `__truncated:N` marker. Used by the IdentityRegistry pass because
// MetadataSet.metadataValue can carry multi-KB attestation payloads that
// blow past Neon HTTP's per-row parameter limit. The decoded args remain
// readable; the raw bytes are recoverable by re-querying the chain via
// (tx_hash, log_index).
function truncateRawLog(log: any, maxBytes: number): string {
  let s = JSON.stringify(log);
  if (s.length <= maxBytes) return s;
  const clone = JSON.parse(s);
  if (clone?.args && typeof clone.args === "object") {
    for (const k of Object.keys(clone.args)) {
      const v = clone.args[k];
      if (typeof v === "string" && v.length > 256) {
        clone.args[k] = `${v.slice(0, 256)}…__truncated:${v.length}`;
      }
    }
  }
  s = JSON.stringify(clone);
  return s.length > maxBytes ? s.slice(0, maxBytes - 32) + "…__truncated_total" : s;
}

// ============================================================================
// Buyer aggregate recompute — single SQL pass per funded buyer wallet.
// ============================================================================

// Cap on in-flight recomputeBuyer() calls. Each call issues Neon HTTP queries,
// and the serverless driver opens one socket (file descriptor) per in-flight
// fetch. A full-table reconcile fanning out one promise per buyer with an
// unbounded Promise.all exhausted the process's file descriptors (EMFILE) and
// took the /api/cron/sync route down. A small pool stays well under the fd
// ceiling while still finishing far faster than a fully serial loop.
const RECOMPUTE_CONCURRENCY = 8;

export async function recomputeBuyers(addresses: string[]) {
  const queue = [...addresses];
  const worker = async () => {
    for (let a = queue.shift(); a !== undefined; a = queue.shift()) {
      await recomputeBuyer(a);
    }
  };
  const pool = Array.from(
    { length: Math.min(RECOMPUTE_CONCURRENCY, queue.length) },
    () => worker(),
  );
  await Promise.all(pool);
}

export async function recomputeBuyer(address: string) {
  const addr = address.toLowerCase();

  const aggResult = await db.execute<{
    settled_sessions: number;
    total_settled: number;
    first_block: number | null;
    last_block: number | null;
    first_ts: number | null;
    last_ts: number | null;
    unique_sellers: number;
    ghost_sessions: number;
  }>(sql`
    WITH base AS (
      SELECT * FROM events WHERE buyer_address = ${addr}
    )
    SELECT
      (SELECT COUNT(DISTINCT channel_id)::int FROM base WHERE event_type='settled') AS settled_sessions,
      (SELECT COALESCE(SUM(delta_usdc),0)::float FROM base WHERE event_type='settled') AS total_settled,
      (SELECT MIN(block_number)::bigint FROM base) AS first_block,
      (SELECT MAX(block_number)::bigint FROM base) AS last_block,
      (SELECT MIN(timestamp)::bigint FROM base) AS first_ts,
      (SELECT MAX(timestamp)::bigint FROM base) AS last_ts,
      (SELECT COUNT(DISTINCT seller_address)::int FROM base WHERE event_type='settled' AND seller_address IS NOT NULL) AS unique_sellers,
      (SELECT COUNT(*)::int FROM base e WHERE e.event_type='closed'
         AND COALESCE(e.settled_amount_usdc,0) = 0
         AND NOT EXISTS (
           SELECT 1 FROM events s WHERE s.channel_id = e.channel_id AND s.event_type='settled'
         )) AS ghost_sessions
  `);

  const a = aggResult.rows[0];
  if (!a) return;

  const aggregate = {
    address: addr,
    totalSessions: Number(a.settled_sessions) || 0,
    totalSettledUsdc: Number(a.total_settled) || 0,
    uniqueSellers: Number(a.unique_sellers) || 0,
    ghostSessions: Number(a.ghost_sessions) || 0,
  };
  const score = calculateTrustScore(aggregate);

  await db
    .insert(buyerProfiles)
    .values({
      address: addr,
      totalSessions: aggregate.totalSessions,
      totalSettledUsdc: aggregate.totalSettledUsdc,
      uniqueSellers: aggregate.uniqueSellers,
      ghostSessions: aggregate.ghostSessions,
      firstSeenBlock: a.first_block ? Number(a.first_block) : null,
      lastSeenBlock: a.last_block ? Number(a.last_block) : null,
      firstSeenTs: a.first_ts ? Number(a.first_ts) : null,
      lastSeenTs: a.last_ts ? Number(a.last_ts) : null,
      trustScore: score.total,
      qualified: score.qualified,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: buyerProfiles.address,
      set: {
        totalSessions: aggregate.totalSessions,
        totalSettledUsdc: aggregate.totalSettledUsdc,
        uniqueSellers: aggregate.uniqueSellers,
        ghostSessions: aggregate.ghostSessions,
        firstSeenBlock: a.first_block ? Number(a.first_block) : null,
        lastSeenBlock: a.last_block ? Number(a.last_block) : null,
        firstSeenTs: a.first_ts ? Number(a.first_ts) : null,
        lastSeenTs: a.last_ts ? Number(a.last_ts) : null,
        trustScore: score.total,
        qualified: score.qualified,
        updatedAt: Date.now(),
      },
    });
}

// Self-healing: if events sum != aggregate-cache sum, recompute every buyer.
// Tolerance is $0.01 (1 cent) — JS double summation of many USDC values
// can drift well above 0.0001, which used to fire this on every pass and
// trigger a full table recompute for no real divergence.
//
// Deadline-aware and resumable: a full sweep can outlast a single cron tick
// once the buyer table is large, so we walk addresses in a stable order and
// persist a cursor after each chunk. When the deadline hits we return cleanly
// (leaving budget for the auxiliary syncs that run after this) and the next
// tick picks up where we left off. The drift gate is only checked when no
// sweep is in progress, so a sweep always runs to completion across ticks
// rather than restarting and stranding the cursor mid-table.
const RECONCILE_CURSOR_KEY = "reconcile_drift_cursor";

export async function reconcileDrift(opts: { deadlineMs?: number } = {}) {
  const startedAt = Date.now();
  const deadlineMs = opts.deadlineMs ?? Infinity;

  const cursor = await getState(RECONCILE_CURSOR_KEY);
  const inProgress = cursor != null && cursor !== "";

  if (!inProgress) {
    const r = await db.execute<{ delta: number }>(sql`
      WITH depositors AS (
        SELECT DISTINCT buyer_address AS address
        FROM events
        WHERE event_type = 'deposited'
          AND buyer_address IS NOT NULL
      )
      SELECT
        ((SELECT COALESCE(SUM(e.delta_usdc),0) FROM events e JOIN depositors d ON d.address = e.buyer_address WHERE e.event_type='settled')
         - (SELECT COALESCE(SUM(bp.total_settled_usdc),0) FROM buyer_profiles bp JOIN depositors d ON d.address = bp.address))::float AS delta
    `);
    if (Math.abs(r.rows[0]?.delta ?? 0) < 0.01) return;
  }

  // Stable ordering so the persisted cursor resumes from the right place.
  // Addresses-only payload stays small even at tens of thousands of buyers.
  const after = inProgress ? cursor! : "";
  const buyers = await db
    .selectDistinct({ a: eventsTbl.buyerAddress })
    .from(eventsTbl)
    .where(sql`${eventsTbl.buyerAddress} IS NOT NULL AND ${eventsTbl.buyerAddress} > ${after}`)
    .orderBy(eventsTbl.buyerAddress);
  const addresses = buyers.flatMap((b) => (b.a ? [b.a] : []));

  // Process in ordered chunks so the cursor always marks a contiguous
  // completed prefix; recomputeBuyers bounds concurrency within each chunk.
  const CHUNK = RECOMPUTE_CONCURRENCY * 4;
  for (let i = 0; i < addresses.length; i += CHUNK) {
    if (Date.now() - startedAt > deadlineMs) return; // cursor already at last completed chunk
    const chunk = addresses.slice(i, i + CHUNK);
    await recomputeBuyers(chunk);
    await setState(RECONCILE_CURSOR_KEY, chunk[chunk.length - 1]);
  }

  // Sweep finished — clear the cursor so the next run re-checks drift afresh.
  await setState(RECONCILE_CURSOR_KEY, "");
}

// ============================================================================
// Provider directory refresh (network.antseed.com/stats).
// EVM seller address = "0x" + first 20 bytes of libp2p peerId.
// ============================================================================

const PROVIDER_TEXT_LIMITS = {
  displayName: 120,
  peerId: 160,
  region: 80,
  service: 120,
};
const MAX_PROVIDER_SERVICES = 100;
const MAX_PROVIDER_DIRECTORY_PEERS = 5_000;
const MAX_PRICE_USD_PER_MILLION = 1_000_000;

export async function readCappedJsonResponse(
  res: Response,
  maxBytes = PROVIDER_DIRECTORY_MAX_BODY_BYTES,
): Promise<unknown> {
  const contentLength = res.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error("provider directory response too large");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (res.body) {
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error("provider directory response too large");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    const buf = new Uint8Array(await res.arrayBuffer());
    total = buf.byteLength;
    if (total > maxBytes) {
      throw new Error("provider directory response too large");
    }
    chunks.push(buf);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

function textOrNull(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed.slice(0, maxLen);
}

function sanitizedServiceName(value: unknown): string | null {
  const service = textOrNull(value, PROVIDER_TEXT_LIMITS.service);
  if (!service) return null;
  return service;
}

function sanitizedTrustScore(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function sanitizedServicePricing(value: unknown): Record<string, number | null> | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const out: Record<string, number | null> = {};
  for (const key of ["inputUsdPerMillion", "outputUsdPerMillion"]) {
    if (raw[key] == null) continue;
    const n = Number(raw[key]);
    if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE_USD_PER_MILLION) {
      return null;
    }
    out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export interface SanitizedProviderPeer {
  row: {
    address: string;
    displayName: string | null;
    peerId: string;
    region: string | null;
    trustScore: number | null;
    services: string | null;
    pricing: string | null;
    operatorAddress: string | null;
    updatedAt: number;
  };
  supersededOperator: string | null;
}

export function sanitizeProviderDirectoryPeer(
  peer: unknown,
  now: number,
): SanitizedProviderPeer | null {
  if (!peer || typeof peer !== "object") return null;
  const rawPeer = peer as Record<string, any>;
  const peerId = textOrNull(rawPeer?.peerId, PROVIDER_TEXT_LIMITS.peerId)?.toLowerCase();
  if (!peerId || peerId.length < 40) return null;
  const hex40 = peerId.slice(0, 40);
  if (!/^[0-9a-f]{40}$/.test(hex40)) return null;
  const operatorAddr = "0x" + hex40;

  // Sellers can settle via a delegation contract; in that case the on-chain
  // seller_address in AntseedChannels events is the contract, not the operator
  // peerId. Key the directory off the contract so rows join to events.
  const scRaw = (rawPeer.sellerContract || "").toString().toLowerCase().replace(/^0x/, "");
  const hasSc = /^[0-9a-f]{40}$/.test(scRaw);
  const addr = hasSc ? "0x" + scRaw : operatorAddr;

  const services: string[] = [];
  const pricing: Record<string, any> = {};
  const providers = Array.isArray(rawPeer.providers) ? rawPeer.providers : [];
  for (const p of providers) {
    const advertisedServices = Array.isArray(p?.services) ? p.services : [];
    for (const rawSvc of advertisedServices) {
      const svc = sanitizedServiceName(rawSvc);
      if (!svc) continue;
      if (!services.includes(svc)) services.push(svc);
      const svcPricing = sanitizedServicePricing(p?.servicePricing?.[svc]);
      if (svcPricing) pricing[svc] = svcPricing;
      if (services.length >= MAX_PROVIDER_SERVICES) break;
    }
    if (services.length >= MAX_PROVIDER_SERVICES) break;
  }

  return {
    row: {
      address: addr,
      displayName: textOrNull(rawPeer.displayName, PROVIDER_TEXT_LIMITS.displayName),
      peerId,
      region: textOrNull(rawPeer.region, PROVIDER_TEXT_LIMITS.region),
      trustScore: sanitizedTrustScore(rawPeer.trustScore),
      services: services.length ? JSON.stringify(services) : null,
      pricing: Object.keys(pricing).length ? JSON.stringify(pricing) : null,
      operatorAddress: hasSc ? operatorAddr : null,
      updatedAt: now,
    },
    supersededOperator: hasSc && addr !== operatorAddr ? operatorAddr : null,
  };
}

export async function refreshProviderDirectory() {
  // Throttle to once an hour — peer listings change slowly and this fetch
  // ran on every cron tick, burning the function budget on a non-essential.
  const last = await getState("provider_dir_refreshed_at");
  if (last && Date.now() - Number(last) < PROVIDER_REFRESH_MS) return;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROVIDER_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://network.antseed.com/stats", {
      cache: "no-store",
      signal: ctl.signal,
    });
    if (!res.ok) return;
    const data = (await readCappedJsonResponse(res)) as { peers?: any[] };
    if (!Array.isArray(data.peers)) return;
    const now = Date.now();
    const rows: any[] = [];
    // Track operator addresses that have been superseded by a seller
    // delegation contract — those operator-keyed rows (created by older
    // indexer builds) need to be deleted so the seller profile resolves
    // to the contract that actually settles on AntseedChannels.
    const supersededOperators: string[] = [];
    for (const peer of data.peers.slice(0, MAX_PROVIDER_DIRECTORY_PEERS)) {
      const sanitized = sanitizeProviderDirectoryPeer(peer, now);
      if (!sanitized) continue;
      rows.push(sanitized.row);
      if (sanitized.supersededOperator) supersededOperators.push(sanitized.supersededOperator);
    }
    if (rows.length === 0) return;
    await db
      .insert(providerDirectory)
      .values(rows)
      .onConflictDoUpdate({
        target: providerDirectory.address,
        set: {
          displayName: sql`excluded.display_name`,
          peerId: sql`excluded.peer_id`,
          region: sql`excluded.region`,
          trustScore: sql`excluded.trust_score`,
          services: sql`excluded.services`,
          pricing: sql`excluded.pricing`,
          operatorAddress: sql`excluded.operator_address`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    if (supersededOperators.length > 0) {
      const safe = supersededOperators.filter((a) => /^0x[0-9a-f]{40}$/.test(a));
      if (safe.length > 0) {
        await db.execute(
          sql`DELETE FROM provider_directory WHERE address IN (${rawAddressList(safe, "superseded operator addresses")})`,
        );
      }
    }
    await setState("provider_dir_refreshed_at", Date.now().toString());
  } catch {
    // Non-fatal — network unreachable, timed out, or upstream returned junk.
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// AntseedStats.MetadataRecorded indexing.
// This is the canonical source for tokens-consumed: the Stats contract is
// only writable by authorized addresses, and each event records the
// per-call (input, output, requestCount) tuple — so SUM across events
// equals the true network-wide token throughput, matching the Dune board.
// ChannelSettled.metadata is opaque seller-provided bytes and is unreliable.
// ============================================================================

const STATS_CURSOR_KEY = "last_indexed_block_antseed_stats";
const STATS_BATCH_KEY = "log_batch_size_antseed_stats";
// AntseedStats fires MetadataRecorded once per inference call, so event
// density per block is much higher than the channels contract. Starting too
// big wastes the first half of each cron tick shrinking. 2_000 is the
// observed ceiling under drpc free tier without range errors.
const STATS_BATCH_INITIAL = 2_000n;
const STATS_BATCH_MAX = 5_000n;
const STATS_BLOCK_SECS = 2;

interface StatsSyncResult {
  ok: boolean;
  fromBlock: string;
  toBlock: string;
  recordsAdded: number;
  error?: string;
}

export async function syncAntseedStats(
  opts: { deadlineMs?: number } = {},
): Promise<StatsSyncResult> {
  const last = await getState(STATS_CURSOR_KEY);
  const lastIndexed = BigInt(
    last || (ANTSEED_STATS_DEPLOYMENT_BLOCK - 1n).toString(),
  );

  let head: bigint;
  try {
    head = await publicClient.getBlockNumber();
  } catch (e: any) {
    return {
      ok: false,
      fromBlock: "?",
      toBlock: "?",
      recordsAdded: 0,
      error: e?.message || String(e),
    };
  }

  const fromBlockStart = lastIndexed + 1n;
  if (fromBlockStart > head) {
    return {
      ok: true,
      fromBlock: fromBlockStart.toString(),
      toBlock: head.toString(),
      recordsAdded: 0,
    };
  }

  // Persist batch size across cron ticks — without this, each tick restarts
  // at STATS_BATCH_INITIAL and burns several seconds shrinking before finding
  // a working size, slowing backfill by an order of magnitude.
  const persistedBatch = await getState(STATS_BATCH_KEY);
  const batchSize = persistedBatch ? BigInt(persistedBatch) : STATS_BATCH_INITIAL;
  let recordsAdded = 0;
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = opts.deadlineMs ?? 20_000;
  const stream = await syncEventStream({
    fromBlockStart,
    head,
    initialBatchSize: batchSize,
    maxBatchSize: STATS_BATCH_MAX,
    cursorKey: STATS_CURSOR_KEY,
    batchKey: STATS_BATCH_KEY,
    deadlineMs: SOFT_DEADLINE_MS,
    startedAt,
    sleepMs: 150,
    getLogs: (fromBlock, toBlock) =>
      publicClient.getLogs({
        address: CONTRACTS.AntseedStats as `0x${string}`,
        events: antseedStatsAbi as any,
        fromBlock,
        toBlock,
      }),
    onLogs: async ({ logs }) => {
      if (logs.length === 0) return;
      const blockTs = await estimateBlockTimestamps({
        logs,
        blockSeconds: STATS_BLOCK_SECS,
        getBlockTimestamp: async (blockNumber) =>
          (await publicClient.getBlock({ blockNumber })).timestamp,
      });

      const rows = (logs as any[]).map((log) => {
        const args = log.args || {};
        // Numbers fit comfortably in JS Number for token counts on this
        // network (per-event values are <1e10). If that ever changes we'll
        // need a numeric column.
        return {
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: Number(log.blockNumber),
          eventType: "metadata_recorded" as EventType,
          buyerAddress: (args.buyer as string | undefined)?.toLowerCase() ?? null,
          sellerAddress: null,
          channelId: (args.channelId as string | undefined) ?? null,
          maxAmountUsdc: null,
          deltaUsdc: null,
          refundUsdc: null,
          settledAmountUsdc: null,
          cumulativeAmountUsdc: null,
          platformFeeUsdc: null,
          newDepositUsdc: null,
          gracePeriodEnd: null,
          inputTokens:
            args.inputTokens != null ? Number(args.inputTokens) : null,
          outputTokens:
            args.outputTokens != null ? Number(args.outputTokens) : null,
          requestCount:
            args.requestCount != null ? Number(args.requestCount) : null,
          timestamp: blockTs.get(log.blockNumber!) ?? 0,
          rawLog: JSON.stringify(serializableLog(log)),
        };
      });

      if (rows.length > 0) {
        const result = await db
          .insert(eventsTbl)
          .values(rows)
          .onConflictDoNothing()
          .returning({ id: eventsTbl.id });
        recordsAdded += result.length;
      }
    },
  });

  return {
    ok: stream.ok,
    fromBlock: stream.fromBlock,
    toBlock: stream.toBlock,
    recordsAdded,
    ...(stream.error ? { error: stream.error } : {}),
  };
}

// ============================================================================
// ANTS token Transfer indexing — maintains live per-address balances.
// We deliberately do not persist individual Transfer events; the only
// downstream consumer is the holder headcount in the Paying Users hero,
// and replaying all transfers would require the same getLogs work each
// time anyway. Balances are stored raw (uint256-scale wei) in numeric so
// dust transfers don't round to zero.
// ============================================================================

const ANTS_CURSOR_KEY = "last_indexed_block_ants_token";
const ANTS_BATCH_KEY = "log_batch_size_ants_token";
// ANTS token has ~41 holders → Transfer event density is very low. Big
// batches are safe and let us backfill 35 days of history in 1–2 cron ticks.
const ANTS_BATCH_INITIAL = 50_000n;
const ANTS_BATCH_MAX = 100_000n;

interface AntsSyncResult {
  ok: boolean;
  fromBlock: string;
  toBlock: string;
  transfersProcessed: number;
  holdersTouched: number;
  error?: string;
}

export async function syncAntsToken(
  opts: { deadlineMs?: number } = {},
): Promise<AntsSyncResult> {
  const last = await getState(ANTS_CURSOR_KEY);
  const lastIndexed = BigInt(
    last || (ANTS_TOKEN_DEPLOYMENT_BLOCK - 1n).toString(),
  );

  let head: bigint;
  try {
    head = await publicClient.getBlockNumber();
  } catch (e: any) {
    return {
      ok: false,
      fromBlock: "?",
      toBlock: "?",
      transfersProcessed: 0,
      holdersTouched: 0,
      error: e?.message || String(e),
    };
  }

  const fromBlockStart = lastIndexed + 1n;
  if (fromBlockStart > head) {
    return {
      ok: true,
      fromBlock: fromBlockStart.toString(),
      toBlock: head.toString(),
      transfersProcessed: 0,
      holdersTouched: 0,
    };
  }

  const persistedBatch = await getState(ANTS_BATCH_KEY);
  const batchSize = persistedBatch ? BigInt(persistedBatch) : ANTS_BATCH_INITIAL;
  let transfersProcessed = 0;
  const totalHoldersTouched = new Set<string>();
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = opts.deadlineMs ?? 10_000;
  const stream = await syncEventStream({
    fromBlockStart,
    head,
    initialBatchSize: batchSize,
    maxBatchSize: ANTS_BATCH_MAX,
    cursorKey: ANTS_CURSOR_KEY,
    batchKey: ANTS_BATCH_KEY,
    deadlineMs: SOFT_DEADLINE_MS,
    startedAt,
    sleepMs: 150,
    getLogs: (fromBlock, toBlock) =>
      publicClient.getLogs({
        address: CONTRACTS.ANTSToken as `0x${string}`,
        events: antsTokenAbi as any,
        fromBlock,
        toBlock,
      }),
    onLogs: async ({ logs }) => {
      const ledgerRows = new Map<string, {
        txHash: string;
        logIndex: number;
        address: string;
        deltaKind: string;
        balanceDelta: bigint;
        stakedDelta: bigint;
        blockNumber: number;
        updatedAt: number;
      }>();
      const batchHoldersTouched = new Set<string>();
      for (const log of logs as any[]) {
        const args = log.args || {};
        const from = (args.from as string | undefined)?.toLowerCase();
        const toAddr = (args.to as string | undefined)?.toLowerCase();
        const value = args.value as bigint | undefined;
        if (!from || !toAddr || value == null) continue;
        const bn = Number(log.blockNumber);
        const addDelta = (address: string, delta: bigint) => {
          const key = `${log.transactionHash}:${log.logIndex}:${address}:balance`;
          const existing = ledgerRows.get(key);
          if (existing) {
            existing.balanceDelta += delta;
          } else {
            ledgerRows.set(key, {
              txHash: log.transactionHash,
              logIndex: Number(log.logIndex),
              address,
              deltaKind: "balance",
              balanceDelta: delta,
              stakedDelta: 0n,
              blockNumber: bn,
              updatedAt: Date.now(),
            });
          }
        };

        if (from !== ZERO_ADDR) {
          addDelta(from, -value);
          batchHoldersTouched.add(from);
          totalHoldersTouched.add(from);
        }
        if (toAddr !== ZERO_ADDR) {
          addDelta(toAddr, value);
          batchHoldersTouched.add(toAddr);
          totalHoldersTouched.add(toAddr);
        }
        transfersProcessed++;
      }

      const rows = [...ledgerRows.values()]
        .filter((r) => r.balanceDelta !== 0n || r.stakedDelta !== 0n)
        .map((r) => ({
          ...r,
          balanceDelta: r.balanceDelta.toString(),
          stakedDelta: r.stakedDelta.toString(),
        }));
      if (rows.length > 0) {
        await db.insert(antsHolderDeltas).values(rows).onConflictDoNothing();
        await recomputeAntsHolderRows(batchHoldersTouched);
      }
    },
  });

  return {
    ok: stream.ok,
    fromBlock: stream.fromBlock,
    toBlock: stream.toBlock,
    transfersProcessed,
    holdersTouched: totalHoldersTouched.size,
    ...(stream.error ? { error: stream.error } : {}),
  };
}

// ============================================================================
// AntseedEmissionsV2.EmissionsClaimed — both buyer and seller claim flows
// fire this. Stored as event_type='ants_claim' rows in the existing events
// table so the activity feed and per-address detail pages surface them without
// any schema churn.
// ============================================================================

const EMISSIONS_CURSOR_KEY = "last_indexed_block_emissions";
const EMISSIONS_BATCH_KEY = "log_batch_size_emissions";
// V2 deployed 2026-05-13; only a few claims so far. Sparse event density,
// big batches are safe and finish backfill in one tick.
const EMISSIONS_BATCH_INITIAL = 50_000n;
const EMISSIONS_BATCH_MAX = 100_000n;

interface EmissionsSyncResult {
  ok: boolean;
  fromBlock: string;
  toBlock: string;
  claimsProcessed: number;
  error?: string;
}

export async function syncEmissions(
  opts: { deadlineMs?: number } = {},
): Promise<EmissionsSyncResult> {
  const last = await getState(EMISSIONS_CURSOR_KEY);
  const lastIndexed = BigInt(
    last || (EMISSIONS_DEPLOYMENT_BLOCK - 1n).toString(),
  );

  let head: bigint;
  try {
    head = await publicClient.getBlockNumber();
  } catch (e: any) {
    return {
      ok: false,
      fromBlock: "?",
      toBlock: "?",
      claimsProcessed: 0,
      error: e?.message || String(e),
    };
  }

  const fromBlockStart = lastIndexed + 1n;
  if (fromBlockStart > head) {
    return {
      ok: true,
      fromBlock: fromBlockStart.toString(),
      toBlock: head.toString(),
      claimsProcessed: 0,
    };
  }

  const persistedBatch = await getState(EMISSIONS_BATCH_KEY);
  const batchSize = persistedBatch ? BigInt(persistedBatch) : EMISSIONS_BATCH_INITIAL;
  let claimsProcessed = 0;
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = opts.deadlineMs ?? 6_000;
  const stream = await syncEventStream({
    fromBlockStart,
    head,
    initialBatchSize: batchSize,
    maxBatchSize: EMISSIONS_BATCH_MAX,
    cursorKey: EMISSIONS_CURSOR_KEY,
    batchKey: EMISSIONS_BATCH_KEY,
    deadlineMs: SOFT_DEADLINE_MS,
    startedAt,
    sleepMs: 150,
    getLogs: (fromBlock, toBlock) =>
      publicClient.getLogs({
        address: CONTRACTS.AntseedEmissions as `0x${string}`,
        events: emissionsAbi as any,
        fromBlock,
        toBlock,
      }),
    onLogs: async ({ logs }) => {
      if (logs.length === 0) return;
      const blockTs = await estimateBlockTimestamps({
        logs,
        getBlockTimestamp: async (blockNumber) =>
          (await publicClient.getBlock({ blockNumber })).timestamp,
      });

      const rows = (logs as any[]).map((log) => {
        const args = log.args || {};
        return {
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: Number(log.blockNumber),
          eventType: "ants_claim" as EventType,
          buyerAddress: (args.account as string | undefined)?.toLowerCase() ?? null,
          sellerAddress: (args.recipient as string | undefined)?.toLowerCase() ?? null,
          channelId: null,
          maxAmountUsdc: null,
          deltaUsdc: null,
          refundUsdc: null,
          settledAmountUsdc: null,
          cumulativeAmountUsdc: null,
          platformFeeUsdc: null,
          newDepositUsdc: null,
          gracePeriodEnd: null,
          inputTokens: null,
          outputTokens: null,
          requestCount: null,
          timestamp: blockTs.get(log.blockNumber!) ?? 0,
          rawLog: JSON.stringify(serializableLog(log)),
        };
      });

      if (rows.length > 0) {
        const result = await db
          .insert(eventsTbl)
          .values(rows)
          .onConflictDoNothing()
          .returning({ id: eventsTbl.id });
        claimsProcessed += result.length;
      }
    },
  });

  return {
    ok: stream.ok,
    fromBlock: stream.fromBlock,
    toBlock: stream.toBlock,
    claimsProcessed,
    ...(stream.error ? { error: stream.error } : {}),
  };
}

// ============================================================================
// AntseedStaking.Staked / Unstaked — seller-side staking events.
// Updates staked_balance in ants_holders so that staked ANTS count toward the
// "$ANT holders" headcount even though liquid balance is 0 while staked.
// Staked: +amount. Unstaked: -amount (slashed portion already gone from their
// stake; we reduce by the full amount that left the staking contract).
// ============================================================================

const STAKING_CURSOR_KEY = "last_indexed_block_staking";
const STAKING_BATCH_KEY = "log_batch_size_staking";
const STAKING_BATCH_INITIAL = 50_000n;
const STAKING_BATCH_MAX = 100_000n;

interface StakingSyncResult {
  ok: boolean;
  fromBlock: string;
  toBlock: string;
  eventsProcessed: number;
  error?: string;
}

export async function syncStaking(
  opts: { deadlineMs?: number } = {},
): Promise<StakingSyncResult> {
  const last = await getState(STAKING_CURSOR_KEY);
  const lastIndexed = BigInt(
    last || (ANTSEED_STAKING_DEPLOYMENT_BLOCK - 1n).toString(),
  );

  let head: bigint;
  try {
    head = await publicClient.getBlockNumber();
  } catch (e: any) {
    return {
      ok: false,
      fromBlock: "?",
      toBlock: "?",
      eventsProcessed: 0,
      error: e?.message || String(e),
    };
  }

  const fromBlockStart = lastIndexed + 1n;
  if (fromBlockStart > head) {
    return {
      ok: true,
      fromBlock: fromBlockStart.toString(),
      toBlock: head.toString(),
      eventsProcessed: 0,
    };
  }

  const persistedBatch = await getState(STAKING_BATCH_KEY);
  const batchSize = persistedBatch ? BigInt(persistedBatch) : STAKING_BATCH_INITIAL;
  let eventsProcessed = 0;
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = opts.deadlineMs ?? 6_000;
  const stream = await syncEventStream({
    fromBlockStart,
    head,
    initialBatchSize: batchSize,
    maxBatchSize: STAKING_BATCH_MAX,
    cursorKey: STAKING_CURSOR_KEY,
    batchKey: STAKING_BATCH_KEY,
    deadlineMs: SOFT_DEADLINE_MS,
    startedAt,
    sleepMs: 150,
    getLogs: (fromBlock, toBlock) =>
      publicClient.getLogs({
        address: CONTRACTS.AntseedStaking as `0x${string}`,
        events: stakingAbi as any,
        fromBlock,
        toBlock,
      }),
    onLogs: async ({ logs }) => {
      if (logs.length === 0) return;
      const ledgerRows = new Map<string, {
        txHash: string;
        logIndex: number;
        address: string;
        deltaKind: string;
        balanceDelta: bigint;
        stakedDelta: bigint;
        blockNumber: number;
        updatedAt: number;
      }>();
      const holdersTouched = new Set<string>();
      for (const log of logs as any[]) {
        const args = log.args || {};
        const addr = (args.seller as string | undefined)?.toLowerCase();
        if (!addr) continue;
        const amount = BigInt(args.amount ?? 0n);
        let delta = 0n;
        if (log.eventName === "Staked") {
          delta = amount;
        } else if (log.eventName === "Unstaked") {
          delta = -amount;
        }
        if (delta === 0n) continue;
        const key = `${log.transactionHash}:${log.logIndex}:${addr}:staked`;
        ledgerRows.set(key, {
          txHash: log.transactionHash,
          logIndex: Number(log.logIndex),
          address: addr,
          deltaKind: "staked",
          balanceDelta: 0n,
          stakedDelta: delta,
          blockNumber: Number(log.blockNumber),
          updatedAt: Date.now(),
        });
        holdersTouched.add(addr);
      }
      eventsProcessed += logs.length;

      const rows = [...ledgerRows.values()].map((r) => ({
        ...r,
        balanceDelta: r.balanceDelta.toString(),
        stakedDelta: r.stakedDelta.toString(),
      }));
      if (rows.length > 0) {
        await db.insert(antsHolderDeltas).values(rows).onConflictDoNothing();
        await recomputeAntsHolderRows(holdersTouched);
      }
    },
  });

  return {
    ok: stream.ok,
    fromBlock: stream.fromBlock,
    toBlock: stream.toBlock,
    eventsProcessed,
    ...(stream.error ? { error: stream.error } : {}),
  };
}

// ============================================================================
// AntseedDeposits.Deposited / WithdrawalExecuted — escrow buyer flows.
// These two events are required for the Dune q6974179 "Daily Active Users"
// widget. Stored as event_type='deposited' and 'withdrawal_executed' rows
// in the existing events table. buyer_address is set; seller_address stays
// null (Deposits is buyer-only). Backfill is handled by
// scripts/_backfill-deposits.ts for speed; the cron path keeps the tail warm.
// ============================================================================

const DEPOSITS_CURSOR_KEY = "last_indexed_block_antseed_deposits";
const DEPOSITS_BATCH_KEY = "log_batch_size_antseed_deposits";
// Deposits density is low (couple per day in steady state). Big batches are
// safe and let the live cron skip across long quiet stretches in one tick.
const DEPOSITS_BATCH_INITIAL = 50_000n;
const DEPOSITS_BATCH_MAX = 100_000n;

interface DepositsSyncResult {
  ok: boolean;
  fromBlock: string;
  toBlock: string;
  recordsAdded: number;
  error?: string;
}

export async function syncAntseedDeposits(
  opts: { deadlineMs?: number } = {},
): Promise<DepositsSyncResult> {
  const last = await getState(DEPOSITS_CURSOR_KEY);
  const lastIndexed = BigInt(
    last || (ANTSEED_DEPOSITS_DEPLOYMENT_BLOCK - 1n).toString(),
  );

  let head: bigint;
  try {
    head = await publicClient.getBlockNumber();
  } catch (e: any) {
    return {
      ok: false,
      fromBlock: "?",
      toBlock: "?",
      recordsAdded: 0,
      error: e?.message || String(e),
    };
  }

  const fromBlockStart = lastIndexed + 1n;
  if (fromBlockStart > head) {
    return {
      ok: true,
      fromBlock: fromBlockStart.toString(),
      toBlock: head.toString(),
      recordsAdded: 0,
    };
  }

  const persistedBatch = await getState(DEPOSITS_BATCH_KEY);
  const batchSize = persistedBatch
    ? BigInt(persistedBatch)
    : DEPOSITS_BATCH_INITIAL;
  let recordsAdded = 0;
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = opts.deadlineMs ?? 6_000;
  const stream = await syncEventStream({
    fromBlockStart,
    head,
    initialBatchSize: batchSize,
    maxBatchSize: DEPOSITS_BATCH_MAX,
    cursorKey: DEPOSITS_CURSOR_KEY,
    batchKey: DEPOSITS_BATCH_KEY,
    deadlineMs: SOFT_DEADLINE_MS,
    startedAt,
    sleepMs: 150,
    getLogs: (fromBlock, toBlock) =>
      publicClient.getLogs({
        address: CONTRACTS.AntseedDeposits as `0x${string}`,
        events: depositsAbi as any,
        fromBlock,
        toBlock,
      }),
    onLogs: async ({ logs }) => {
      if (logs.length === 0) return;
      const blockTs = await estimateBlockTimestamps({
        logs,
        getBlockTimestamp: async (blockNumber) =>
          (await publicClient.getBlock({ blockNumber })).timestamp,
      });

      // For Deposited events, the event's `buyer` field is a caller-supplied
      // parameter (deposit(address buyer, uint256 amount)) and can differ from
      // the actual payer wallet. tx.from is the real payer. Fetch in parallel;
      // steady-state batches have 0-2 deposits so this is fast. Rate-limit
      // failures are logged (not silently swallowed) and fall back to args.buyer.
      // WithdrawalExecuted keeps args.buyer (msg.sender calls withdraw for self).
      const depositedTxHashes = [
        ...new Set(
          (logs as any[])
            .filter((l) => mapEventType(l.eventName) === "deposited")
            .map((l) => l.transactionHash)
            .filter(Boolean),
        ),
      ] as `0x${string}`[];
      const txFromMap = new Map<string, string>();
      if (depositedTxHashes.length > 0) {
        const results = await Promise.allSettled(
          depositedTxHashes.map((hash) => publicClient.getTransaction({ hash })),
        );
        for (let i = 0; i < depositedTxHashes.length; i++) {
          const r = results[i];
          if (r.status === "fulfilled") {
            txFromMap.set(depositedTxHashes[i], r.value.from.toLowerCase());
          } else {
            console.warn("[indexer] getTransaction failed for deposit", depositedTxHashes[i], (r.reason as any)?.message?.slice(0, 80));
          }
        }
      }

      const rows = (logs as any[]).map((log) => {
        const args = log.args || {};
        const eventType = mapEventType(log.eventName);
        const isDeposited = eventType === "deposited";
        const buyerAddress = isDeposited
          ? (txFromMap.get(log.transactionHash) ?? (args.buyer as string | undefined)?.toLowerCase() ?? null)
          : (args.buyer as string | undefined)?.toLowerCase() ?? null;
        return {
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: Number(log.blockNumber),
          eventType: (eventType ?? "deposited") as EventType,
          buyerAddress,
          sellerAddress: null,
          channelId: null,
          // amount is escrow-USDC (6 decimals) — store as USDC float for
          // parity with the rest of the table; we only need address+day for
          // DAU, but recording the amount is cheap and lets LTV land later
          // without a re-index.
          maxAmountUsdc:
            isDeposited && args.amount != null
              ? usdcAtomsToNumber(args.amount)
              : null,
          deltaUsdc: null,
          refundUsdc:
            eventType === "withdrawal_executed" && args.amount != null
              ? usdcAtomsToNumber(args.amount)
              : null,
          settledAmountUsdc: null,
          cumulativeAmountUsdc: null,
          platformFeeUsdc: null,
          newDepositUsdc: null,
          gracePeriodEnd: null,
          inputTokens: null,
          outputTokens: null,
          requestCount: null,
          timestamp: blockTs.get(log.blockNumber!) ?? 0,
          rawLog: JSON.stringify(serializableLog(log)),
        };
      });

      if (rows.length > 0) {
        // Use DO UPDATE so that re-syncing historical blocks (after cursor reset)
        // overwrites the old args.buyer value with the correct tx.from.
        const result = await db
          .insert(eventsTbl)
          .values(rows)
          .onConflictDoUpdate({
            target: [eventsTbl.txHash, eventsTbl.logIndex],
            set: { buyerAddress: sql`EXCLUDED.buyer_address` },
          })
          .returning({ id: eventsTbl.id });
        recordsAdded += result.length;

        // Ensure every depositor has an aggregate-cache row so they appear on
        // /buyers even if they never opened a channel. Rows land with 0
        // sessions / $0 settled and sort to the bottom of the qualified view.
        const depositors = [
          ...new Set(
            rows
              .filter((r) => r.eventType === "deposited" && r.buyerAddress)
              .map((r) => r.buyerAddress as string),
          ),
        ];
        if (depositors.length > 0) {
          await recomputeBuyers(depositors);
        }
      }
    },
  });

  return {
    ok: stream.ok,
    fromBlock: stream.fromBlock,
    toBlock: stream.toBlock,
    recordsAdded,
    ...(stream.error ? { error: stream.error } : {}),
  };
}

// ============================================================================
// Daily Active Users pre-aggregate.
// One row per UTC day in `daily_dau`, populated from the events table. This
// is the authoritative implementation of Dune q6974179:
//   • DAU       = COUNT(DISTINCT addr) over 8 (event_type, address) pairs:
//                 (deposited,buyer), (withdrawal_executed,buyer),
//                 (reserved,buyer), (reserved,seller),
//                 (settled,buyer),  (settled,seller),
//                 (closed,buyer),   (closed,seller)
//   • new_users = count of buyers whose lifetime-first `deposited` event
//                 falls on this day. Sellers never count as new — this
//                 mirrors Dune exactly.
//   • dau_buyers / dau_sellers scope DAU to the corresponding role only.
// timestamp→day uses to_timestamp(...)::date which produces UTC, matching
// Dune's date_trunc('day', evt_block_time).
// ============================================================================

export async function recomputeDailyDau(days: string[]) {
  // De-dup + drop invalids.
  const ds = [...new Set(days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))];
  if (ds.length === 0) return;
  const now = Date.now();
  for (const day of ds) {
    await recomputeDailyDauOne(day, now);
  }
}

async function recomputeDailyDauOne(day: string, now: number) {
  // Single SQL statement: compute the four metrics for the given day from
  // the union of activity rows, plus the first-deposit lookup for new_users.
  const dayLiteral = rawDateLiteral(day, "daily DAU recompute day");
  await db.execute(sql`
    WITH user_activity AS (
      SELECT buyer_address AS addr, 'buyer' AS role
      FROM events
      WHERE event_type IN ('deposited','withdrawal_executed','reserved','settled','closed')
        AND buyer_address IS NOT NULL
        AND timestamp > 0
        AND to_timestamp(timestamp)::date = ${dayLiteral}
      UNION ALL
      SELECT seller_address AS addr, 'seller' AS role
      FROM events
      WHERE event_type IN ('reserved','settled','closed')
        AND seller_address IS NOT NULL
        AND timestamp > 0
        AND to_timestamp(timestamp)::date = ${dayLiteral}
    ),
    first_deposits AS (
      SELECT buyer_address AS addr, MIN(to_timestamp(timestamp)::date) AS first_day
      FROM events
      WHERE event_type = 'deposited'
        AND buyer_address IS NOT NULL
        AND timestamp > 0
      GROUP BY 1
    ),
    a AS (
      SELECT
        COUNT(DISTINCT addr)::int AS dau,
        COUNT(DISTINCT CASE WHEN role='buyer'  THEN addr END)::int AS dau_buyers,
        COUNT(DISTINCT CASE WHEN role='seller' THEN addr END)::int AS dau_sellers
      FROM user_activity
    ),
    n AS (
      SELECT COUNT(*)::int AS new_users
      FROM first_deposits
      WHERE first_day = ${dayLiteral}
    )
    INSERT INTO daily_dau (day, dau, dau_buyers, dau_sellers, new_users, last_recomputed_at)
    SELECT ${dayLiteral}, a.dau, a.dau_buyers, a.dau_sellers, n.new_users, ${now}
    FROM a, n
    ON CONFLICT (day) DO UPDATE SET
      dau                = EXCLUDED.dau,
      dau_buyers         = EXCLUDED.dau_buyers,
      dau_sellers        = EXCLUDED.dau_sellers,
      new_users          = EXCLUDED.new_users,
      last_recomputed_at = EXCLUDED.last_recomputed_at
  `);
}

// Recompute the most recent `n` UTC days — used by the cron path to keep
// the live "today" + "yesterday" rows warm without scanning the full table.
export async function recomputeDailyDauRecent(n: number) {
  const today = new Date();
  const days: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getTime() - i * 86_400_000);
    days.push(d.toISOString().slice(0, 10));
  }
  await recomputeDailyDau(days);
}

// ============================================================================
// ERC-8004 IdentityRegistry — agent identity NFT registry. We index three
// lifecycle/attestation events as rows in the existing events table:
//   • Registered    → event_type='identity_registered'
//   • URIUpdated    → event_type='identity_uri_updated'
//   • MetadataSet   → event_type='identity_metadata_set'
// The contract is the shared ERC-8004 registry on Base (predates the Antseed
// deployment by ~2 months), so the registry holds many non-Antseed agents.
// We FILTER to only Antseed-relevant rows on insert: an owner address that
// has touched the marketplace (channel/deposit events) or appears in the
// provider directory, or any agentId we've already accepted via a prior
// Registered. The full-firehose sweep used to ingest every agent on Base;
// that data was unused and cost Neon storage + write bandwidth.
// Schema reuse: agentId → channel_id (text), agentURI / new URI text →
// raw_log (already stored), owner → buyer_address, updater → seller_address.
// Limitation: a seller whose Registered event predates their first channel
// activity won't have their identity history captured by the forward sync.
// Run scripts/_identity-backfill-owners.ts (or equivalent) to retroactively
// pull historical Registered events for known sellers when needed.
// ============================================================================

// Loads the two sets used to decide whether an IdentityRegistry log is
// Antseed-relevant. Cheap (two indexed SELECTs); called once per sync run.
async function loadAntseedIdentitySets(): Promise<{
  addrs: Set<string>;
  agentIds: Set<string>;
}> {
  const [addrRows, identRows] = await Promise.all([
    db.execute<{ addr: string }>(sql`
      SELECT DISTINCT lower(addr) AS addr FROM (
        SELECT buyer_address AS addr FROM events
          WHERE buyer_address IS NOT NULL
            AND event_type NOT LIKE 'identity_%'
        UNION
        SELECT seller_address AS addr FROM events
          WHERE seller_address IS NOT NULL
            AND event_type NOT LIKE 'identity_%'
        UNION
        SELECT address AS addr FROM provider_directory
        UNION
        SELECT operator_address AS addr FROM provider_directory
          WHERE operator_address IS NOT NULL
      ) t
      WHERE addr IS NOT NULL
    `),
    db.execute<{ agent_id: string }>(sql`
      SELECT DISTINCT channel_id AS agent_id
      FROM events
      WHERE event_type = 'identity_registered'
        AND channel_id IS NOT NULL
    `),
  ]);
  const addrs = new Set<string>();
  for (const r of addrRows.rows) if (r.addr) addrs.add(r.addr);
  const agentIds = new Set<string>();
  for (const r of identRows.rows) if (r.agent_id) agentIds.add(r.agent_id);
  return { addrs, agentIds };
}

const IDENTITY_CURSOR_KEY = "last_indexed_block_identity_registry";
const IDENTITY_BATCH_KEY = "log_batch_size_identity_registry";
// 66k tx since Feb 2026 across ~3.5M blocks. Event density is low-medium —
// start with a moderate batch and let the auto-shrink/grow logic find the
// right value the same way the other passes do. Cap raised to 50_000:
// publicnode (https://base-rpc.publicnode.com) accepts that range in ~5s.
// If the configured RPC has a tighter limit (e.g. drpc free-tier at 10k),
// the auto-shrink on range errors will discover and persist the lower cap.
const IDENTITY_BATCH_INITIAL = 2_000n;
const IDENTITY_BATCH_MAX = 50_000n;

interface IdentitySyncResult {
  ok: boolean;
  fromBlock: string;
  toBlock: string;
  recordsAdded: number;
  error?: string;
}

export async function syncIdentityRegistry(
  opts: { deadlineMs?: number } = {},
): Promise<IdentitySyncResult> {
  const last = await getState(IDENTITY_CURSOR_KEY);
  const lastIndexed = BigInt(
    last || (IDENTITY_REGISTRY_DEPLOYMENT_BLOCK - 1n).toString(),
  );

  let head: bigint;
  try {
    head = await publicClient.getBlockNumber();
  } catch (e: any) {
    return {
      ok: false,
      fromBlock: "?",
      toBlock: "?",
      recordsAdded: 0,
      error: e?.message || String(e),
    };
  }

  const fromBlockStart = lastIndexed + 1n;
  if (fromBlockStart > head) {
    return {
      ok: true,
      fromBlock: fromBlockStart.toString(),
      toBlock: head.toString(),
      recordsAdded: 0,
    };
  }

  const persistedBatch = await getState(IDENTITY_BATCH_KEY);
  const batchSize = persistedBatch
    ? BigInt(persistedBatch)
    : IDENTITY_BATCH_INITIAL;
  let recordsAdded = 0;
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = opts.deadlineMs ?? 6_000;
  // Antseed-relevance sets, loaded once per run. agentIds is mutated as we
  // accept new Registered rows so URIUpdated/MetadataSet later in the same
  // run are kept without a re-query.
  const { addrs, agentIds } = await loadAntseedIdentitySets();
  const stream = await syncEventStream({
    fromBlockStart,
    head,
    initialBatchSize: batchSize,
    maxBatchSize: IDENTITY_BATCH_MAX,
    cursorKey: IDENTITY_CURSOR_KEY,
    batchKey: IDENTITY_BATCH_KEY,
    deadlineMs: SOFT_DEADLINE_MS,
    startedAt,
    sleepMs: 150,
    getLogs: (fromBlock, toBlock) =>
      publicClient.getLogs({
        address: CONTRACTS.IdentityRegistry as `0x${string}`,
        events: identityRegistryAbi as any,
        fromBlock,
        toBlock,
      }),
    onLogs: async ({ logs }) => {
      if (logs.length === 0) return;
      const blockTs = await estimateBlockTimestamps({
        logs,
        getBlockTimestamp: async (blockNumber) =>
          (await publicClient.getBlock({ blockNumber })).timestamp,
      });

      const rows = (logs as any[]).map((log) => {
        const args = log.args || {};
        const eventType = mapIdentityEventType(log.eventName);
        // agentId is a uint256; bigint → string for the text channel_id slot.
        // It's a deterministic per-row key, fits the "find this token's
        // history" use case the channel_id column was built for.
        const agentId =
          args.agentId != null ? (args.agentId as bigint).toString() : null;
        return {
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: Number(log.blockNumber),
          eventType: (eventType ?? "identity_registered") as EventType,
          // owner / updater are stuffed into the existing address columns:
          // buyer_address = the identity's owner (Registered.owner),
          // seller_address = whoever made the change (URIUpdated.updatedBy).
          // MetadataSet has no address arg — both stay null.
          buyerAddress: (args.owner as string | undefined)?.toLowerCase() ?? null,
          sellerAddress:
            (args.updatedBy as string | undefined)?.toLowerCase() ?? null,
          channelId: agentId,
          maxAmountUsdc: null,
          deltaUsdc: null,
          refundUsdc: null,
          settledAmountUsdc: null,
          cumulativeAmountUsdc: null,
          platformFeeUsdc: null,
          newDepositUsdc: null,
          gracePeriodEnd: null,
          inputTokens: null,
          outputTokens: null,
          requestCount: null,
          timestamp: blockTs.get(log.blockNumber!) ?? 0,
          // URI strings / metadata bytes are preserved in raw_log. MetadataSet
          // events can carry multi-KB byte payloads (the actual attestation
          // bodies), so we cap at 8KB to fit Neon HTTP's request-size limit.
          // The decoded args are JSON-friendly; the raw bytes are recoverable
          // via the (tx_hash, log_index) key against the chain if needed.
          rawLog: truncateRawLog(serializableLog(log), 8_192),
        };
      });

      // Drop rows that don't pertain to an Antseed-relevant agent. Registered
      // is the gate: owner must be a known Antseed address. URIUpdated and
      // MetadataSet ride on the agentId being one we've already accepted.
      const filtered = rows.filter((row) => {
        if (row.eventType === "identity_registered") {
          const owner = row.buyerAddress;
          if (owner && addrs.has(owner) && row.channelId) {
            agentIds.add(row.channelId);
            return true;
          }
          return false;
        }
        return row.channelId != null && agentIds.has(row.channelId);
      });

      // Chunk inserts to keep each Neon HTTP request small enough — a single
      // 10k-block batch can hold ~300 logs and the resulting parameter blob
      // exceeds Neon's transmit limit. 50 rows/insert ≈ 100KB payload.
      const CHUNK = 50;
      for (let i = 0; i < filtered.length; i += CHUNK) {
        const chunk = filtered.slice(i, i + CHUNK);
        const result = await db
          .insert(eventsTbl)
          .values(chunk)
          .onConflictDoNothing()
          .returning({ id: eventsTbl.id });
        recordsAdded += result.length;
      }
    },
  });

  return {
    ok: stream.ok,
    fromBlock: stream.fromBlock,
    toBlock: stream.toBlock,
    recordsAdded,
    ...(stream.error ? { error: stream.error } : {}),
  };
}

function mapIdentityEventType(name: string | undefined): EventType | null {
  switch (name) {
    case "Registered": return "identity_registered";
    case "URIUpdated": return "identity_uri_updated";
    case "MetadataSet": return "identity_metadata_set";
    default: return null;
  }
}

// Full backfill: recompute every day from the earliest event to today.
// Cheap (~37 rows today) — safe to run at deploy or from a script.
export async function recomputeDailyDauAll() {
  const r = await db.execute<{ min_ts: string | null }>(sql`
    SELECT MIN(timestamp)::bigint AS min_ts FROM events WHERE timestamp > 0
  `);
  const minTs = r.rows[0]?.min_ts ? Number(r.rows[0].min_ts) : null;
  if (!minTs) return;
  const start = new Date(minTs * 1000);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const days: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  await recomputeDailyDau(days);
  return days.length;
}
