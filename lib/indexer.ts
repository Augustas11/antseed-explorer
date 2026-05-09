import { type Log } from "viem";
import { publicClient } from "./chain";
import {
  CONTRACTS,
  CHANNELS_DEPLOYMENT_BLOCK,
  channelsAbi,
  type EventType,
} from "./antseed";
import { db, getState, setState, tryAcquireSyncLock, releaseSyncLock } from "./db";
import { events as eventsTbl, buyerProfiles, providerDirectory } from "./schema";
import { sql } from "drizzle-orm";
import { calculateTrustScore } from "./score";

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

  try {
    return await runSync(opts);
  } finally {
    await releaseSyncLock();
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
  let eventsAdded = 0;
  const persisted = await getState("log_batch_size");
  let batchSize = persisted ? BigInt(persisted) : ENV_BATCH_SIZE;
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
    try {
      logs = await publicClient.getLogs({
        address: channelsAddress,
        events: channelsAbi as any,
        fromBlock: cursor.from,
        toBlock: to,
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (isRangeError(msg) && batchSize > 1n) {
        batchSize = batchSize > 20n ? 10n : batchSize / 2n;
        if (batchSize < 1n) batchSize = 1n;
        await setState("log_batch_size", batchSize.toString());
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

    // Batch block-timestamp lookups in parallel — meaningful win on Neon's HTTP.
    const uniqueBlocks = [
      ...new Set(logs.map((l) => l.blockNumber).filter((b): b is bigint => !!b)),
    ];
    const blockEntries = await Promise.all(
      uniqueBlocks.map(async (bn) => {
        const blk = await publicClient.getBlock({ blockNumber: bn });
        return [bn, Number(blk.timestamp)] as const;
      }),
    );
    const blockTs = new Map<bigint, number>(blockEntries);

    const rows: any[] = [];
    for (const log of logs as any[]) {
      const eventType = mapEventType(log.eventName);
      if (!eventType) continue;
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
        maxAmountUsdc: args.maxAmount ? Number(args.maxAmount) / USDC_DECIMALS : null,
        deltaUsdc: args.delta ? Number(args.delta) / USDC_DECIMALS : null,
        refundUsdc: args.refund ? Number(args.refund) / USDC_DECIMALS : null,
        settledAmountUsdc: args.settledAmount
          ? Number(args.settledAmount) / USDC_DECIMALS
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
    }

    await setState("last_indexed_block", to.toString());
    cursor.from = to + 1n;
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
function decodeMetadata(metadata: string | undefined):
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

function mapEventType(name: string | undefined): EventType | null {
  switch (name) {
    case "Reserved": return "reserved";
    case "ChannelSettled": return "settled";
    case "ChannelClosed": return "closed";
    case "ChannelTopUp": return "topup";
    case "ChannelWithdrawn": return "withdrawn";
    case "CloseRequested": return "close_requested";
    default: return null;
  }
}

function serializableLog(log: any) {
  return JSON.parse(
    JSON.stringify(log, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
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
export async function reconcileDrift() {
  const r = await db.execute<{ delta: number }>(sql`
    SELECT
      ((SELECT COALESCE(SUM(delta_usdc),0) FROM events WHERE event_type='settled')
       - (SELECT COALESCE(SUM(total_settled_usdc),0) FROM buyer_profiles))::float AS delta
  `);
  if (Math.abs(r.rows[0]?.delta ?? 0) < 0.0001) return;
  const buyers = await db
    .selectDistinct({ a: eventsTbl.buyerAddress })
    .from(eventsTbl)
    .where(sql`${eventsTbl.buyerAddress} IS NOT NULL`);
  for (const b of buyers) if (b.a) await recomputeBuyer(b.a);
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
    for (const peer of data.peers || []) {
      const peerId = peer.peerId?.toString().toLowerCase();
      if (!peerId || peerId.length < 40) continue;
      const addr = "0x" + peerId.slice(0, 40);
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
          updatedAt: sql`excluded.updated_at`,
        },
      });
  } catch {
    // Non-fatal — network unreachable, timed out, or upstream returned junk.
  } finally {
    clearTimeout(timer);
    await setState("provider_dir_refreshed_at", Date.now().toString());
  }
}
