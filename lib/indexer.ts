import { type Log } from "viem";
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
import { events as eventsTbl, buyerProfiles, providerDirectory } from "./schema";
import { sql } from "drizzle-orm";
import { calculateTrustScore } from "./score";
import { emit } from "./emitter";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const ENV_BATCH_SIZE = BigInt(process.env.LOG_BATCH_SIZE || 2000);
const SYNC_DEBOUNCE_MS = 60_000;
const USDC_DECIMALS = 1_000_000;
const PROVIDER_REFRESH_MS = 60 * 60 * 1000; // 1h
const PROVIDER_FETCH_TIMEOUT_MS = 5_000;

const channelsAddress = (process.env.CHANNELS_ADDRESS ||
  CONTRACTS.AntseedChannels) as `0x${string}`;

const startBlockEnv = process.env.START_BLOCK
  ? BigInt(process.env.START_BLOCK)
  : CHANNELS_DEPLOYMENT_BLOCK;

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

export async function sync(opts: { force?: boolean; deadlineMs?: number } = {}): Promise<SyncResult> {
  if (!opts.force && !(await shouldSync())) {
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

  // Concurrency lock — cron + manual sync can fire simultaneously, and Neon
  // HTTP is connectionless so two passes can race on `last_indexed_block`.
  // Stale-after exceeds the 60s deadline so a killed instance recovers.
  const acquired = await tryAcquireSyncLock(90_000);
  if (!acquired) {
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
    const channels = await runSync(opts);
    // Auxiliary syncs share the rest of the cron budget. Stats is heaviest
    // (full backfill in progress), so it gets the largest slice; ANTS and
    // Emissions are smaller and fast — give them a guaranteed minimum even
    // when stats is still chewing through history. Each wrapped so any one
    // failing cannot block the others or poison the channels result.
    const cronBudgetMs = opts.deadlineMs ?? 50_000;
    const reserveForAntsAndEmissions = 12_000; // 6s each, headroom for slow ticks
    const elapsedMs = Date.now() - syncStart;
    const statsDeadline = Math.max(
      5_000,
      cronBudgetMs - elapsedMs - reserveForAntsAndEmissions - 3_000,
    );
    try {
      await syncAntseedStats({ deadlineMs: statsDeadline });
    } catch (e) {
      console.warn("[indexer] antseed_stats sync failed:", (e as Error)?.message || e);
    }

    const elapsedAfterStats = Date.now() - syncStart;
    const antsDeadline = Math.max(
      3_000,
      Math.floor((cronBudgetMs - elapsedAfterStats - 3_000) / 2),
    );
    try {
      await syncAntsToken({ deadlineMs: antsDeadline });
    } catch (e) {
      console.warn("[indexer] ants_token sync failed:", (e as Error)?.message || e);
    }

    const elapsedAfterAnts = Date.now() - syncStart;
    // Split remaining budget across emissions + deposits. Deposits has very
    // low event density (couple per day) so 5s is plenty in steady state;
    // backfill is handled by a one-shot script.
    const tailBudgetMs = Math.max(4_000, cronBudgetMs - elapsedAfterAnts - 3_000);
    const emissionsDeadline = Math.max(2_000, Math.floor(tailBudgetMs / 2));
    try {
      await syncEmissions({ deadlineMs: emissionsDeadline });
    } catch (e) {
      console.warn("[indexer] emissions sync failed:", (e as Error)?.message || e);
    }

    const elapsedAfterEmissions = Date.now() - syncStart;
    // Split remaining tail budget across staking + deposits + identity.
    // Staking has very low density (sellers stake infrequently); deposits
    // similarly sparse; identity is doing a full backfill from 41_663_783
    // on first sync so it benefits from the larger slice once the others catch up.
    const tailRemainingMs = Math.max(6_000, cronBudgetMs - elapsedAfterEmissions - 2_000);
    const stakingDeadline = Math.max(2_000, Math.floor(tailRemainingMs / 3));
    try {
      await syncStaking({ deadlineMs: stakingDeadline });
    } catch (e) {
      console.warn("[indexer] staking sync failed:", (e as Error)?.message || e);
    }

    const elapsedAfterStaking = Date.now() - syncStart;
    const tailAfterStakingMs = Math.max(4_000, cronBudgetMs - elapsedAfterStaking - 2_000);
    const depositsDeadline = Math.max(2_000, Math.floor(tailAfterStakingMs / 2));
    try {
      await syncAntseedDeposits({ deadlineMs: depositsDeadline });
    } catch (e) {
      console.warn("[indexer] antseed_deposits sync failed:", (e as Error)?.message || e);
    }

    const elapsedAfterDeposits = Date.now() - syncStart;
    const identityDeadline = Math.max(
      2_000,
      cronBudgetMs - elapsedAfterDeposits - 2_000,
    );
    try {
      await syncIdentityRegistry({ deadlineMs: identityDeadline });
    } catch (e) {
      console.warn("[indexer] identity_registry sync failed:", (e as Error)?.message || e);
    }

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
    await releaseSyncLock();
    // Stamp last_sync_ts even on partial/error runs so the dashboard "Updated X ago"
    // dot reflects when the indexer last ran, not just when it last fully succeeded.
    // runSync already writes this on success paths; this catches early-return errors.
    await setState("last_sync_ts", Date.now().toString());
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
  let batchSize = persisted ? BigInt(persisted) : ENV_BATCH_SIZE;
  let consecutiveSuccesses = 0;
  // Default deadline; cron callers may override (Vercel Pro = 60s).
  const SOFT_DEADLINE_MS = opts.deadlineMs ?? 25_000;
  const startedAt = Date.now();
  const cursor = { from: fromBlock };

  while (cursor.from <= head) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      await recomputeBuyers([...buyersTouched]);
      await setState("last_sync_ts", Date.now().toString());
      return {
        ok: true,
        fromBlock: fromBlock.toString(),
        toBlock: cursor.from.toString(),
        eventsAdded,
        buyersTouched: buyersTouched.size,
        skipped: "deadline_partial",
      };
    }

    const to =
      cursor.from + batchSize - 1n > head ? head : cursor.from + batchSize - 1n;

    let logs: Log[];
    let rateLimitRetries = 0;
    while (true) {
      try {
        logs = await publicClient.getLogs({
          address: channelsAddress,
          events: channelsAbi as any,
          fromBlock: cursor.from,
          toBlock: to,
        });
        break;
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (isRangeError(msg) && batchSize > 1n) {
          batchSize = batchSize > 20n ? 10n : batchSize / 2n;
          if (batchSize < 1n) batchSize = 1n;
          await setState("log_batch_size", batchSize.toString());
          consecutiveSuccesses = 0;
          break; // re-enter outer loop with smaller batchSize, logs stays undefined
        }
        if (isRateLimitError(msg) && rateLimitRetries < 3) {
          rateLimitRetries++;
          await sleep(1500 * rateLimitRetries);
          continue;
        }
        return {
          ok: false,
          fromBlock: cursor.from.toString(),
          toBlock: to.toString(),
          eventsAdded,
          buyersTouched: buyersTouched.size,
          error: msg,
        };
      }
    }
    if (!logs!) {
      // Range error shrunk batchSize — retry outer loop with new size.
      continue;
    }

    // Fetch one anchor block timestamp and interpolate the rest.
    // Base has a ~2 s block time so interpolation is accurate within a few
    // seconds — fine for "X ago" display. One RPC call per batch instead of
    // N parallel calls keeps us well under Alchemy's CU/sec limit.
    const uniqueBlocks = [
      ...new Set(logs.map((l) => l.blockNumber).filter((b): b is bigint => !!b)),
    ];
    const blockTs = new Map<bigint, number>();
    if (uniqueBlocks.length > 0) {
      const anchorBn = uniqueBlocks.reduce((a, b) => (b > a ? b : a));
      let anchorTs = 0;
      try {
        const blk = await publicClient.getBlock({ blockNumber: anchorBn });
        anchorTs = Number(blk.timestamp);
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (isRateLimitError(msg)) await sleep(2000);
        // Non-fatal: fall back to 0 timestamps for this batch.
      }
      const BASE_BLOCK_SECS = 2;
      for (const bn of uniqueBlocks) {
        const diff = Number(anchorBn - bn);
        blockTs.set(bn, anchorTs > 0 ? anchorTs - diff * BASE_BLOCK_SECS : 0);
      }
    }

    const rows: any[] = [];
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
      rows.push({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: Number(log.blockNumber),
        eventType,
        buyerAddress: buyer,
        sellerAddress: seller,
        channelId,
        maxAmountUsdc: (args.maxAmount ?? args.additionalAmount)
          ? Number(args.maxAmount ?? args.additionalAmount) / USDC_DECIMALS
          : null,
        deltaUsdc: args.delta ? Number(args.delta) / USDC_DECIMALS : null,
        refundUsdc: args.refund ? Number(args.refund) / USDC_DECIMALS : null,
        settledAmountUsdc: (args.settledAmount ?? args.totalSettled)
          ? Number(args.settledAmount ?? args.totalSettled) / USDC_DECIMALS
          : null,
        cumulativeAmountUsdc: args.cumulativeAmount
          ? Number(args.cumulativeAmount) / USDC_DECIMALS
          : null,
        platformFeeUsdc: args.platformFee
          ? Number(args.platformFee) / USDC_DECIMALS
          : null,
        newDepositUsdc: args.newDeposit
          ? Number(args.newDeposit) / USDC_DECIMALS
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
      if (buyer) buyersTouched.add(buyer);
    }

    if (rows.length > 0) {
      const result = await db
        .insert(eventsTbl)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: eventsTbl.id });
      eventsAdded += result.length;
      if (result.length > 0) {
        for (const row of rows) {
          emit({
            type: row.eventType,
            txHash: row.txHash,
            blockNumber: row.blockNumber,
            buyerAddress: row.buyerAddress,
            sellerAddress: row.sellerAddress,
            channelId: row.channelId,
            deltaUsdc: row.deltaUsdc,
            timestamp: row.timestamp,
          });
        }
      }
    }

    await setState("last_indexed_block", to.toString());
    consecutiveSuccesses += 1;
    if (consecutiveSuccesses >= 5 && batchSize < ENV_BATCH_SIZE) {
      batchSize = batchSize * 2n > ENV_BATCH_SIZE ? ENV_BATCH_SIZE : batchSize * 2n;
      await setState("log_batch_size", batchSize.toString());
      consecutiveSuccesses = 0;
    }
    cursor.from = to + 1n;
    // Pace requests to stay under Alchemy's 300 CU/sec limit.
    await sleep(300);
  }

  if (unknownEventNames.size > 0) {
    console.warn("[indexer] unknown event types skipped:", [...unknownEventNames].join(", "));
  }
  await recomputeBuyers([...buyersTouched]);
  await reconcileDrift();
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

// ChannelSettled.metadata is abi-encoded as 4 uint256s:
//   [version, totalInputTokens, totalOutputTokens, totalRequests]
export function decodeMetadata(metadata: string | undefined):
  | { version: number; inputTokens: number; outputTokens: number; requestCount: number }
  | null {
  if (!metadata || typeof metadata !== "string") return null;
  const hex = metadata.startsWith("0x") ? metadata.slice(2) : metadata;
  if (hex.length < 64 * 4) return null;
  const word = (i: number) => BigInt("0x" + hex.slice(i * 64, (i + 1) * 64));
  try {
    return {
      version: Number(word(0)),
      inputTokens: Number(word(1)),
      outputTokens: Number(word(2)),
      requestCount: Number(word(3)),
    };
  } catch {
    return null;
  }
}

function isRangeError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("block range") ||
    m.includes("10 block") ||
    m.includes("more than") ||
    m.includes("query returned more") ||
    m.includes("limit exceeded") ||
    (m.includes("eth_getlogs") && m.includes("range"))
  );
}

function isRateLimitError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("compute units per second") ||
    m.includes("rate limit") ||
    m.includes("too many requests") ||
    m.includes("429")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
// Profile recompute — single SQL pass per buyer.
// ============================================================================

export async function recomputeBuyers(addresses: string[]) {
  for (const a of addresses) await recomputeBuyer(a);
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

  const profile = {
    address: addr,
    totalSessions: Number(a.settled_sessions) || 0,
    totalSettledUsdc: Number(a.total_settled) || 0,
    uniqueSellers: Number(a.unique_sellers) || 0,
    ghostSessions: Number(a.ghost_sessions) || 0,
  };
  const score = calculateTrustScore(profile);

  await db
    .insert(buyerProfiles)
    .values({
      address: addr,
      totalSessions: profile.totalSessions,
      totalSettledUsdc: profile.totalSettledUsdc,
      uniqueSellers: profile.uniqueSellers,
      ghostSessions: profile.ghostSessions,
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
        totalSessions: profile.totalSessions,
        totalSettledUsdc: profile.totalSettledUsdc,
        uniqueSellers: profile.uniqueSellers,
        ghostSessions: profile.ghostSessions,
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

// Self-healing: if events sum != profiles sum, recompute every buyer.
// Tolerance is $0.01 (1 cent) — JS double summation of many USDC values
// can drift well above 0.0001, which used to fire this on every pass and
// trigger a full table recompute for no real divergence.
export async function reconcileDrift() {
  const r = await db.execute<{ delta: number }>(sql`
    SELECT
      ((SELECT COALESCE(SUM(delta_usdc),0) FROM events WHERE event_type='settled')
       - (SELECT COALESCE(SUM(total_settled_usdc),0) FROM buyer_profiles))::float AS delta
  `);
  if (Math.abs(r.rows[0]?.delta ?? 0) < 0.01) return;
  const buyers = await db
    .selectDistinct({ a: eventsTbl.buyerAddress })
    .from(eventsTbl)
    .where(sql`${eventsTbl.buyerAddress} IS NOT NULL`);
  await Promise.all(buyers.filter(b => b.a).map(b => recomputeBuyer(b.a!)));
}

// ============================================================================
// Provider directory refresh (network.antseed.com/stats).
// EVM seller address = "0x" + first 20 bytes of libp2p peerId.
// ============================================================================

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
    const data = (await res.json()) as { peers?: any[] };
    const now = Date.now();
    const rows: any[] = [];
    // Track operator addresses that have been superseded by a seller
    // delegation contract — those operator-keyed rows (created by older
    // indexer builds) need to be deleted so the seller profile resolves
    // to the contract that actually settles on AntseedChannels.
    const supersededOperators: string[] = [];
    for (const peer of data.peers || []) {
      const peerId = peer.peerId?.toString().toLowerCase();
      if (!peerId || peerId.length < 40) continue;
      const hex40 = peerId.slice(0, 40);
      if (!/^[0-9a-f]{40}$/.test(hex40)) continue;
      const operatorAddr = "0x" + hex40;

      // Sellers can settle via a delegation contract; in that case the
      // on-chain seller_address in AntseedChannels events is the contract,
      // not the operator peerId. Key the directory off the contract so the
      // row joins to events; remember the operator for display.
      const scRaw = (peer.sellerContract || "").toString().toLowerCase().replace(/^0x/, "");
      const hasSc = /^[0-9a-f]{40}$/.test(scRaw);
      const addr = hasSc ? "0x" + scRaw : operatorAddr;
      if (hasSc && addr !== operatorAddr) supersededOperators.push(operatorAddr);

      const services: string[] = [];
      const pricing: Record<string, any> = {};
      for (const p of peer.providers || []) {
        for (const svc of p.services || []) {
          if (!services.includes(svc)) services.push(svc);
          if (p.servicePricing?.[svc]) pricing[svc] = p.servicePricing[svc];
        }
      }
      rows.push({
        address: addr,
        displayName: peer.displayName || null,
        peerId: peer.peerId || null,
        region: peer.region || null,
        trustScore: peer.trustScore ?? null,
        services: services.length ? JSON.stringify(services) : null,
        pricing: Object.keys(pricing).length ? JSON.stringify(pricing) : null,
        operatorAddress: hasSc ? operatorAddr : null,
        updatedAt: now,
      });
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
      const safe = supersededOperators
        .filter((a) => /^0x[0-9a-f]{40}$/.test(a))
        .map((a) => `'${a}'`)
        .join(",");
      if (safe) {
        await db.execute(
          sql`DELETE FROM provider_directory WHERE address IN (${sql.raw(safe)})`,
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
  let batchSize = persistedBatch ? BigInt(persistedBatch) : STATS_BATCH_INITIAL;
  if (batchSize > STATS_BATCH_MAX) batchSize = STATS_BATCH_MAX;
  let consecutiveSuccesses = 0;
  let recordsAdded = 0;
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = opts.deadlineMs ?? 20_000;
  const cursor = { from: fromBlockStart };

  while (cursor.from <= head) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      return {
        ok: true,
        fromBlock: fromBlockStart.toString(),
        toBlock: cursor.from.toString(),
        recordsAdded,
        error: "deadline_partial",
      };
    }

    const to =
      cursor.from + batchSize - 1n > head ? head : cursor.from + batchSize - 1n;

    let logs: Log[];
    let rateLimitRetries = 0;
    while (true) {
      try {
        logs = await publicClient.getLogs({
          address: CONTRACTS.AntseedStats as `0x${string}`,
          events: antseedStatsAbi as any,
          fromBlock: cursor.from,
          toBlock: to,
        });
        break;
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (isRangeError(msg) && batchSize > 1n) {
          batchSize = batchSize > 20n ? batchSize / 2n : 10n;
          if (batchSize < 1n) batchSize = 1n;
          await setState(STATS_BATCH_KEY, batchSize.toString());
          consecutiveSuccesses = 0;
          break;
        }
        if (isRateLimitError(msg) && rateLimitRetries < 3) {
          rateLimitRetries++;
          await sleep(1500 * rateLimitRetries);
          continue;
        }
        return {
          ok: false,
          fromBlock: cursor.from.toString(),
          toBlock: to.toString(),
          recordsAdded,
          error: msg,
        };
      }
    }
    if (!logs!) continue;

    if (logs.length > 0) {
      const uniqueBlocks = [
        ...new Set(logs.map((l) => l.blockNumber).filter((b): b is bigint => !!b)),
      ];
      const blockTs = new Map<bigint, number>();
      if (uniqueBlocks.length > 0) {
        const anchorBn = uniqueBlocks.reduce((a, b) => (b > a ? b : a));
        try {
          const blk = await publicClient.getBlock({ blockNumber: anchorBn });
          const anchorTs = Number(blk.timestamp);
          for (const bn of uniqueBlocks) {
            const diff = Number(anchorBn - bn);
            blockTs.set(bn, anchorTs - diff * STATS_BLOCK_SECS);
          }
        } catch {
          // Timestamp fetch is non-fatal — fall back to 0.
        }
      }

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
    }

    await setState(STATS_CURSOR_KEY, to.toString());
    consecutiveSuccesses += 1;
    if (consecutiveSuccesses >= 5 && batchSize < STATS_BATCH_MAX) {
      batchSize =
        batchSize * 2n > STATS_BATCH_MAX ? STATS_BATCH_MAX : batchSize * 2n;
      await setState(STATS_BATCH_KEY, batchSize.toString());
      consecutiveSuccesses = 0;
    }
    cursor.from = to + 1n;
    // 150ms — drpc free tier permits this; channels uses 300ms to share
    // the rate budget with the heavier ChannelSettled decode pass.
    await sleep(150);
  }

  return {
    ok: true,
    fromBlock: fromBlockStart.toString(),
    toBlock: head.toString(),
    recordsAdded,
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
  let batchSize = persistedBatch ? BigInt(persistedBatch) : ANTS_BATCH_INITIAL;
  if (batchSize > ANTS_BATCH_MAX) batchSize = ANTS_BATCH_MAX;
  let consecutiveSuccesses = 0;
  let transfersProcessed = 0;
  const holdersTouched = new Set<string>();
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = opts.deadlineMs ?? 10_000;
  const cursor = { from: fromBlockStart };

  while (cursor.from <= head) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      return {
        ok: true,
        fromBlock: fromBlockStart.toString(),
        toBlock: cursor.from.toString(),
        transfersProcessed,
        holdersTouched: holdersTouched.size,
        error: "deadline_partial",
      };
    }

    const to =
      cursor.from + batchSize - 1n > head ? head : cursor.from + batchSize - 1n;

    let logs: Log[];
    let rateLimitRetries = 0;
    while (true) {
      try {
        logs = await publicClient.getLogs({
          address: CONTRACTS.ANTSToken as `0x${string}`,
          events: antsTokenAbi as any,
          fromBlock: cursor.from,
          toBlock: to,
        });
        break;
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (isRangeError(msg) && batchSize > 1n) {
          batchSize = batchSize > 20n ? batchSize / 2n : 10n;
          if (batchSize < 1n) batchSize = 1n;
          await setState(ANTS_BATCH_KEY, batchSize.toString());
          consecutiveSuccesses = 0;
          break;
        }
        if (isRateLimitError(msg) && rateLimitRetries < 3) {
          rateLimitRetries++;
          await sleep(1500 * rateLimitRetries);
          continue;
        }
        return {
          ok: false,
          fromBlock: cursor.from.toString(),
          toBlock: to.toString(),
          transfersProcessed,
          holdersTouched: holdersTouched.size,
          error: msg,
        };
      }
    }
    if (!logs!) continue;

    // Coalesce deltas inside the batch — many transfers can touch the
    // same address (DEX routers, hot wallets); one UPDATE per net change
    // is much cheaper than one per log.
    const deltas = new Map<string, bigint>();
    const blockMap = new Map<string, { first: number; last: number }>();
    for (const log of logs as any[]) {
      const args = log.args || {};
      const from = (args.from as string | undefined)?.toLowerCase();
      const toAddr = (args.to as string | undefined)?.toLowerCase();
      const value = args.value as bigint | undefined;
      if (!from || !toAddr || value == null) continue;
      const bn = Number(log.blockNumber);

      if (from !== ZERO_ADDR) {
        deltas.set(from, (deltas.get(from) ?? 0n) - value);
        const e = blockMap.get(from);
        if (e) {
          e.last = Math.max(e.last, bn);
          e.first = Math.min(e.first, bn);
        } else {
          blockMap.set(from, { first: bn, last: bn });
        }
        holdersTouched.add(from);
      }
      if (toAddr !== ZERO_ADDR) {
        deltas.set(toAddr, (deltas.get(toAddr) ?? 0n) + value);
        const e = blockMap.get(toAddr);
        if (e) {
          e.last = Math.max(e.last, bn);
          e.first = Math.min(e.first, bn);
        } else {
          blockMap.set(toAddr, { first: bn, last: bn });
        }
        holdersTouched.add(toAddr);
      }
      transfersProcessed++;
    }

    const now = Date.now();
    for (const [addr, delta] of deltas) {
      if (delta === 0n) continue;
      const meta = blockMap.get(addr)!;
      const deltaStr = delta.toString();
      await db.execute(sql`
        INSERT INTO ants_holders (address, balance, first_seen_block, last_seen_block, updated_at)
        VALUES (${addr}, ${sql.raw(`'${deltaStr}'::numeric`)}, ${meta.first}, ${meta.last}, ${now})
        ON CONFLICT (address) DO UPDATE SET
          balance = ants_holders.balance + ${sql.raw(`'${deltaStr}'::numeric`)},
          first_seen_block = LEAST(COALESCE(ants_holders.first_seen_block, ${meta.first}), ${meta.first}),
          last_seen_block = GREATEST(COALESCE(ants_holders.last_seen_block, ${meta.last}), ${meta.last}),
          updated_at = ${now}
      `);
    }

    await setState(ANTS_CURSOR_KEY, to.toString());
    consecutiveSuccesses += 1;
    if (consecutiveSuccesses >= 5 && batchSize < ANTS_BATCH_MAX) {
      batchSize =
        batchSize * 2n > ANTS_BATCH_MAX ? ANTS_BATCH_MAX : batchSize * 2n;
      await setState(ANTS_BATCH_KEY, batchSize.toString());
      consecutiveSuccesses = 0;
    }
    cursor.from = to + 1n;
    await sleep(150);
  }

  return {
    ok: true,
    fromBlock: fromBlockStart.toString(),
    toBlock: head.toString(),
    transfersProcessed,
    holdersTouched: holdersTouched.size,
  };
}

// ============================================================================
// AntseedEmissionsV2.EmissionsClaimed — both buyer and seller claim flows
// fire this. Stored as event_type='ants_claim' rows in the existing events
// table so the activity feed and per-address profiles surface them without
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
  let batchSize = persistedBatch ? BigInt(persistedBatch) : EMISSIONS_BATCH_INITIAL;
  if (batchSize > EMISSIONS_BATCH_MAX) batchSize = EMISSIONS_BATCH_MAX;
  let consecutiveSuccesses = 0;
  let claimsProcessed = 0;
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = opts.deadlineMs ?? 6_000;
  const cursor = { from: fromBlockStart };

  while (cursor.from <= head) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      return {
        ok: true,
        fromBlock: fromBlockStart.toString(),
        toBlock: cursor.from.toString(),
        claimsProcessed,
        error: "deadline_partial",
      };
    }

    const to =
      cursor.from + batchSize - 1n > head ? head : cursor.from + batchSize - 1n;

    let logs: Log[];
    let rateLimitRetries = 0;
    while (true) {
      try {
        logs = await publicClient.getLogs({
          address: CONTRACTS.AntseedEmissions as `0x${string}`,
          events: emissionsAbi as any,
          fromBlock: cursor.from,
          toBlock: to,
        });
        break;
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (isRangeError(msg) && batchSize > 1n) {
          batchSize = batchSize > 20n ? batchSize / 2n : 10n;
          if (batchSize < 1n) batchSize = 1n;
          await setState(EMISSIONS_BATCH_KEY, batchSize.toString());
          consecutiveSuccesses = 0;
          break;
        }
        if (isRateLimitError(msg) && rateLimitRetries < 3) {
          rateLimitRetries++;
          await sleep(1500 * rateLimitRetries);
          continue;
        }
        return {
          ok: false,
          fromBlock: cursor.from.toString(),
          toBlock: to.toString(),
          claimsProcessed,
          error: msg,
        };
      }
    }
    if (!logs!) continue;

    if (logs.length > 0) {
      const uniqueBlocks = [
        ...new Set(logs.map((l) => l.blockNumber).filter((b): b is bigint => !!b)),
      ];
      const blockTs = new Map<bigint, number>();
      if (uniqueBlocks.length > 0) {
        const anchorBn = uniqueBlocks.reduce((a, b) => (b > a ? b : a));
        try {
          const blk = await publicClient.getBlock({ blockNumber: anchorBn });
          const anchorTs = Number(blk.timestamp);
          for (const bn of uniqueBlocks) {
            const diff = Number(anchorBn - bn);
            blockTs.set(bn, anchorTs - diff * 2);
          }
        } catch {
          // Timestamp fetch is non-fatal — fall back to 0.
        }
      }

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
    }

    await setState(EMISSIONS_CURSOR_KEY, to.toString());
    consecutiveSuccesses += 1;
    if (consecutiveSuccesses >= 5 && batchSize < EMISSIONS_BATCH_MAX) {
      batchSize =
        batchSize * 2n > EMISSIONS_BATCH_MAX
          ? EMISSIONS_BATCH_MAX
          : batchSize * 2n;
      await setState(EMISSIONS_BATCH_KEY, batchSize.toString());
      consecutiveSuccesses = 0;
    }
    cursor.from = to + 1n;
    await sleep(150);
  }

  return {
    ok: true,
    fromBlock: fromBlockStart.toString(),
    toBlock: head.toString(),
    claimsProcessed,
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
  let batchSize = persistedBatch ? BigInt(persistedBatch) : STAKING_BATCH_INITIAL;
  if (batchSize > STAKING_BATCH_MAX) batchSize = STAKING_BATCH_MAX;
  let consecutiveSuccesses = 0;
  let eventsProcessed = 0;
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = opts.deadlineMs ?? 6_000;
  const cursor = { from: fromBlockStart };

  while (cursor.from <= head) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      return {
        ok: true,
        fromBlock: fromBlockStart.toString(),
        toBlock: cursor.from.toString(),
        eventsProcessed,
        error: "deadline_partial",
      };
    }

    const to =
      cursor.from + batchSize - 1n > head ? head : cursor.from + batchSize - 1n;

    let logs: Log[];
    let rateLimitRetries = 0;
    while (true) {
      try {
        logs = await publicClient.getLogs({
          address: CONTRACTS.AntseedStaking as `0x${string}`,
          events: stakingAbi as any,
          fromBlock: cursor.from,
          toBlock: to,
        });
        break;
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (isRangeError(msg) && batchSize > 1n) {
          batchSize = batchSize > 20n ? batchSize / 2n : 10n;
          if (batchSize < 1n) batchSize = 1n;
          await setState(STAKING_BATCH_KEY, batchSize.toString());
          consecutiveSuccesses = 0;
          break;
        }
        if (isRateLimitError(msg) && rateLimitRetries < 3) {
          rateLimitRetries++;
          await sleep(1500 * rateLimitRetries);
          continue;
        }
        return {
          ok: false,
          fromBlock: cursor.from.toString(),
          toBlock: to.toString(),
          eventsProcessed,
          error: msg,
        };
      }
    }
    if (!logs!) continue;

    if (logs.length > 0) {
      // Coalesce net staked_balance delta per address across this batch.
      const deltas = new Map<string, bigint>();
      for (const log of logs as any[]) {
        const args = log.args || {};
        const addr = (args.seller as string | undefined)?.toLowerCase();
        if (!addr) continue;
        const amount = BigInt(args.amount ?? 0n);
        const prev = deltas.get(addr) ?? 0n;
        if (log.eventName === "Staked") {
          deltas.set(addr, prev + amount);
        } else if (log.eventName === "Unstaked") {
          deltas.set(addr, prev - amount);
        }
      }
      eventsProcessed += logs.length;

      const now = Math.floor(Date.now() / 1000);
      for (const [addr, delta] of deltas) {
        if (delta === 0n) continue;
        const deltaStr = delta.toString();
        await db.execute(sql`
          INSERT INTO ants_holders (address, balance, staked_balance, updated_at)
          VALUES (${addr}, '0', ${sql.raw(`'${deltaStr}'::numeric`)}, ${now})
          ON CONFLICT (address) DO UPDATE SET
            staked_balance = GREATEST('0'::numeric, ants_holders.staked_balance + ${sql.raw(`'${deltaStr}'::numeric`)}),
            updated_at = ${now}
        `);
      }
    }

    await setState(STAKING_CURSOR_KEY, to.toString());
    consecutiveSuccesses += 1;
    if (consecutiveSuccesses >= 5 && batchSize < STAKING_BATCH_MAX) {
      batchSize =
        batchSize * 2n > STAKING_BATCH_MAX ? STAKING_BATCH_MAX : batchSize * 2n;
      await setState(STAKING_BATCH_KEY, batchSize.toString());
      consecutiveSuccesses = 0;
    }
    cursor.from = to + 1n;
    await sleep(150);
  }

  return {
    ok: true,
    fromBlock: fromBlockStart.toString(),
    toBlock: head.toString(),
    eventsProcessed,
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
  let batchSize = persistedBatch
    ? BigInt(persistedBatch)
    : DEPOSITS_BATCH_INITIAL;
  if (batchSize > DEPOSITS_BATCH_MAX) batchSize = DEPOSITS_BATCH_MAX;
  let consecutiveSuccesses = 0;
  let recordsAdded = 0;
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = opts.deadlineMs ?? 6_000;
  const cursor = { from: fromBlockStart };

  while (cursor.from <= head) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      return {
        ok: true,
        fromBlock: fromBlockStart.toString(),
        toBlock: cursor.from.toString(),
        recordsAdded,
        error: "deadline_partial",
      };
    }

    const to =
      cursor.from + batchSize - 1n > head ? head : cursor.from + batchSize - 1n;

    let logs: Log[];
    let rateLimitRetries = 0;
    while (true) {
      try {
        logs = await publicClient.getLogs({
          address: CONTRACTS.AntseedDeposits as `0x${string}`,
          events: depositsAbi as any,
          fromBlock: cursor.from,
          toBlock: to,
        });
        break;
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (isRangeError(msg) && batchSize > 1n) {
          batchSize = batchSize > 20n ? batchSize / 2n : 10n;
          if (batchSize < 1n) batchSize = 1n;
          await setState(DEPOSITS_BATCH_KEY, batchSize.toString());
          consecutiveSuccesses = 0;
          break;
        }
        if (isRateLimitError(msg) && rateLimitRetries < 3) {
          rateLimitRetries++;
          await sleep(1500 * rateLimitRetries);
          continue;
        }
        return {
          ok: false,
          fromBlock: cursor.from.toString(),
          toBlock: to.toString(),
          recordsAdded,
          error: msg,
        };
      }
    }
    if (!logs!) continue;

    if (logs.length > 0) {
      const uniqueBlocks = [
        ...new Set(logs.map((l) => l.blockNumber).filter((b): b is bigint => !!b)),
      ];
      const blockTs = new Map<bigint, number>();
      if (uniqueBlocks.length > 0) {
        const anchorBn = uniqueBlocks.reduce((a, b) => (b > a ? b : a));
        try {
          const blk = await publicClient.getBlock({ blockNumber: anchorBn });
          const anchorTs = Number(blk.timestamp);
          for (const bn of uniqueBlocks) {
            const diff = Number(anchorBn - bn);
            blockTs.set(bn, anchorTs - diff * 2);
          }
        } catch {
          // Timestamp fetch is non-fatal — fall back to 0.
        }
      }

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
              ? Number(args.amount) / USDC_DECIMALS
              : null,
          deltaUsdc: null,
          refundUsdc:
            eventType === "withdrawal_executed" && args.amount != null
              ? Number(args.amount) / USDC_DECIMALS
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
      }
    }

    await setState(DEPOSITS_CURSOR_KEY, to.toString());
    consecutiveSuccesses += 1;
    if (consecutiveSuccesses >= 5 && batchSize < DEPOSITS_BATCH_MAX) {
      batchSize =
        batchSize * 2n > DEPOSITS_BATCH_MAX
          ? DEPOSITS_BATCH_MAX
          : batchSize * 2n;
      await setState(DEPOSITS_BATCH_KEY, batchSize.toString());
      consecutiveSuccesses = 0;
    }
    cursor.from = to + 1n;
    await sleep(150);
  }

  return {
    ok: true,
    fromBlock: fromBlockStart.toString(),
    toBlock: head.toString(),
    recordsAdded,
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
  // Inline-safe because `day` is sanitized to YYYY-MM-DD by the caller.
  await db.execute(sql`
    WITH user_activity AS (
      SELECT buyer_address AS addr, 'buyer' AS role
      FROM events
      WHERE event_type IN ('deposited','withdrawal_executed','reserved','settled','closed')
        AND buyer_address IS NOT NULL
        AND timestamp > 0
        AND to_timestamp(timestamp)::date = ${sql.raw(`DATE '${day}'`)}
      UNION ALL
      SELECT seller_address AS addr, 'seller' AS role
      FROM events
      WHERE event_type IN ('reserved','settled','closed')
        AND seller_address IS NOT NULL
        AND timestamp > 0
        AND to_timestamp(timestamp)::date = ${sql.raw(`DATE '${day}'`)}
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
      WHERE first_day = ${sql.raw(`DATE '${day}'`)}
    )
    INSERT INTO daily_dau (day, dau, dau_buyers, dau_sellers, new_users, last_recomputed_at)
    SELECT ${sql.raw(`DATE '${day}'`)}, a.dau, a.dau_buyers, a.dau_sellers, n.new_users, ${now}
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
  let batchSize = persistedBatch
    ? BigInt(persistedBatch)
    : IDENTITY_BATCH_INITIAL;
  if (batchSize > IDENTITY_BATCH_MAX) batchSize = IDENTITY_BATCH_MAX;
  let consecutiveSuccesses = 0;
  let recordsAdded = 0;
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = opts.deadlineMs ?? 6_000;
  const cursor = { from: fromBlockStart };
  // Antseed-relevance sets, loaded once per run. agentIds is mutated as we
  // accept new Registered rows so URIUpdated/MetadataSet later in the same
  // run are kept without a re-query.
  const { addrs, agentIds } = await loadAntseedIdentitySets();

  while (cursor.from <= head) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      return {
        ok: true,
        fromBlock: fromBlockStart.toString(),
        toBlock: cursor.from.toString(),
        recordsAdded,
        error: "deadline_partial",
      };
    }

    const to =
      cursor.from + batchSize - 1n > head ? head : cursor.from + batchSize - 1n;

    let logs: Log[];
    let rateLimitRetries = 0;
    while (true) {
      try {
        logs = await publicClient.getLogs({
          address: CONTRACTS.IdentityRegistry as `0x${string}`,
          events: identityRegistryAbi as any,
          fromBlock: cursor.from,
          toBlock: to,
        });
        break;
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (isRangeError(msg) && batchSize > 1n) {
          batchSize = batchSize > 20n ? batchSize / 2n : 10n;
          if (batchSize < 1n) batchSize = 1n;
          await setState(IDENTITY_BATCH_KEY, batchSize.toString());
          consecutiveSuccesses = 0;
          break;
        }
        if (isRateLimitError(msg) && rateLimitRetries < 3) {
          rateLimitRetries++;
          await sleep(1500 * rateLimitRetries);
          continue;
        }
        return {
          ok: false,
          fromBlock: cursor.from.toString(),
          toBlock: to.toString(),
          recordsAdded,
          error: msg,
        };
      }
    }
    if (!logs!) continue;

    if (logs.length > 0) {
      const uniqueBlocks = [
        ...new Set(logs.map((l) => l.blockNumber).filter((b): b is bigint => !!b)),
      ];
      const blockTs = new Map<bigint, number>();
      if (uniqueBlocks.length > 0) {
        const anchorBn = uniqueBlocks.reduce((a, b) => (b > a ? b : a));
        try {
          const blk = await publicClient.getBlock({ blockNumber: anchorBn });
          const anchorTs = Number(blk.timestamp);
          for (const bn of uniqueBlocks) {
            const diff = Number(anchorBn - bn);
            blockTs.set(bn, anchorTs - diff * 2);
          }
        } catch {
          // Timestamp fetch is non-fatal — fall back to 0.
        }
      }

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
    }

    await setState(IDENTITY_CURSOR_KEY, to.toString());
    consecutiveSuccesses += 1;
    if (consecutiveSuccesses >= 5 && batchSize < IDENTITY_BATCH_MAX) {
      batchSize =
        batchSize * 2n > IDENTITY_BATCH_MAX
          ? IDENTITY_BATCH_MAX
          : batchSize * 2n;
      await setState(IDENTITY_BATCH_KEY, batchSize.toString());
      consecutiveSuccesses = 0;
    }
    cursor.from = to + 1n;
    await sleep(150);
  }

  return {
    ok: true,
    fromBlock: fromBlockStart.toString(),
    toBlock: head.toString(),
    recordsAdded,
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
