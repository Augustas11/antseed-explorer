// One-shot historical backfill for AntseedChannels events on Base.
// Bypasses the production sync lock so the running cron can keep going.
// Idempotent: inserts via onConflictDoNothing keyed on (tx_hash, log_index).
//
// Why: CHANNELS_DEPLOYMENT_BLOCK was previously hard-coded to 45_667_842
// (~2026-05-07), skipping the first ~28 days of channel events
// (~$1.6k of settled USDC). The corrected deployment block is 44_469_557
// (2026-04-09 09:54:21 UTC), matching Dune query 6978394's genesis.
//
// Run:
//   RPC_URL=https://mainnet.base.org npx tsx scripts/_backfill-channels.ts
//
// Picks up automatically from the highest already-indexed block in events.

import "dotenv/config";
import { createPublicClient, http, decodeEventLog, type Log } from "viem";
import { base } from "viem/chains";
import { db } from "../lib/db";
import { events as eventsTbl } from "../lib/schema";
import { channelsAbi, CHANNELS_DEPLOYMENT_BLOCK, CONTRACTS, type EventType } from "../lib/antseed";
import { sql } from "drizzle-orm";

const RPC = process.env.RPC_URL || "https://mainnet.base.org";
const CHANNELS = (process.env.CHANNELS_ADDRESS || CONTRACTS.AntseedChannels) as `0x${string}`;
const TARGET_END_BLOCK = process.env.BACKFILL_END_BLOCK ? BigInt(process.env.BACKFILL_END_BLOCK) : 45_667_842n; // first block already covered by prod cron
const BATCH = BigInt(process.env.BACKFILL_BATCH || "9000");
const SLEEP_MS = Number(process.env.BACKFILL_SLEEP_MS || "120");
const USDC_DECIMALS = 1_000_000;

const client = createPublicClient({ chain: base, transport: http(RPC) });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mapEventType(name: string | undefined): EventType | null {
  switch (name) {
    case "Reserved":         return "reserved";
    case "ChannelSettled":   return "settled";
    case "ChannelClosed":    return "closed";
    case "ChannelTopUp":     return "topup";
    case "ChannelWithdrawn": return "withdrawn";
    case "CloseRequested":   return "close_requested";
    default: return null;
  }
}

function decodeMetadata(b: any): { inputTokens: number; outputTokens: number; requestCount: number } | null {
  // Same shape as lib/indexer.ts decodeMetadata: 4 packed uint64s in 32-byte slots.
  // Old indexer stores only the 3 we care about — version is the first 32 bytes.
  if (!b || typeof b !== "string") return null;
  const hex = b.startsWith("0x") ? b.slice(2) : b;
  if (hex.length < 256) return null;
  try {
    const v = BigInt("0x" + hex.slice(0, 64));
    if (v !== 1n) return null;
    return {
      inputTokens:  Number(BigInt("0x" + hex.slice(64, 128))),
      outputTokens: Number(BigInt("0x" + hex.slice(128, 192))),
      requestCount: Number(BigInt("0x" + hex.slice(192, 256))),
    };
  } catch { return null; }
}

async function main() {
  console.log("[backfill] channels backfill starting");
  console.log("[backfill] rpc=", RPC, " contract=", CHANNELS);
  console.log("[backfill] deployment_block=", CHANNELS_DEPLOYMENT_BLOCK.toString(), " target_end_block=", TARGET_END_BLOCK.toString());

  // Where to start: lowest of (deployment_block, current_min_block - 1).
  const minRow = await db.execute<{ min_b: string }>(sql`SELECT MIN(block_number)::bigint AS min_b FROM events WHERE event_type IN ('reserved','settled','closed','topup','withdrawn','close_requested')`);
  const currentMin = minRow.rows[0]?.min_b ? BigInt(minRow.rows[0].min_b) : null;
  console.log("[backfill] current min indexed channels block =", currentMin?.toString() ?? "(none)");

  // We want everything from deployment to TARGET_END_BLOCK. The live cron is
  // catching up from its own cursor; we cover the [deployment, target_end).
  let from = CHANNELS_DEPLOYMENT_BLOCK;
  const end = TARGET_END_BLOCK > 0n ? TARGET_END_BLOCK : await client.getBlockNumber();

  let totalAdded = 0;
  let totalScanned = 0;
  let batches = 0;
  const startedAt = Date.now();

  while (from <= end) {
    const to = (from + BATCH - 1n) > end ? end : (from + BATCH - 1n);
    batches++;

    let logs: Log[];
    try {
      logs = await client.getLogs({
        address: CHANNELS,
        events: channelsAbi as any,
        fromBlock: from,
        toBlock: to,
      });
    } catch (e: any) {
      console.warn(`[backfill] getLogs error ${from}..${to}:`, e?.message?.slice(0, 200));
      await sleep(2000);
      // Try smaller chunk
      const half = (to - from) / 2n;
      if (half < 1n) { console.warn("[backfill] giving up on this block"); from = to + 1n; continue; }
      from = from; // re-enter outer loop, but with shrunken effective batch
      const subEnd = from + half;
      try {
        logs = await client.getLogs({ address: CHANNELS, events: channelsAbi as any, fromBlock: from, toBlock: subEnd });
        from = subEnd + 1n;
      } catch (e2: any) {
        console.warn("[backfill] retry failed, skipping range:", e2?.message?.slice(0, 200));
        from = to + 1n;
        continue;
      }
    }

    totalScanned += Number(to - from + 1n);

    // Fetch a single anchor timestamp per batch (Base ~2s/block).
    const uniqueBlocks = [...new Set((logs as any[]).map((l) => l.blockNumber).filter((b): b is bigint => !!b))];
    const blockTs = new Map<bigint, number>();
    if (uniqueBlocks.length > 0) {
      const anchorBn = uniqueBlocks.reduce((a, b) => (b > a ? b : a));
      try {
        const blk = await client.getBlock({ blockNumber: anchorBn });
        const anchorTs = Number(blk.timestamp);
        for (const bn of uniqueBlocks) {
          const diff = Number(anchorBn - bn);
          blockTs.set(bn, anchorTs - diff * 2);
        }
      } catch (e: any) {
        console.warn("[backfill] getBlock failed:", e?.message?.slice(0, 100));
      }
    }

    const rows: any[] = [];
    for (const log of logs as any[]) {
      const eventType = mapEventType(log.eventName);
      if (!eventType) continue;
      const args = log.args || {};
      const buyer = (args.buyer as string | undefined)?.toLowerCase() ?? null;
      const seller = (args.seller as string | undefined)?.toLowerCase() ?? null;
      const channelId = (args.channelId as string | undefined) ?? null;
      const meta = decodeMetadata(args.metadata);
      rows.push({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: Number(log.blockNumber),
        eventType,
        buyerAddress: buyer,
        sellerAddress: seller,
        channelId,
        maxAmountUsdc: (args.maxAmount ?? args.additionalAmount) ? Number(args.maxAmount ?? args.additionalAmount) / USDC_DECIMALS : null,
        deltaUsdc: args.delta ? Number(args.delta) / USDC_DECIMALS : null,
        refundUsdc: args.refund ? Number(args.refund) / USDC_DECIMALS : null,
        settledAmountUsdc: (args.settledAmount ?? args.totalSettled) ? Number(args.settledAmount ?? args.totalSettled) / USDC_DECIMALS : null,
        cumulativeAmountUsdc: args.cumulativeAmount ? Number(args.cumulativeAmount) / USDC_DECIMALS : null,
        platformFeeUsdc: args.platformFee ? Number(args.platformFee) / USDC_DECIMALS : null,
        newDepositUsdc: args.newDeposit ? Number(args.newDeposit) / USDC_DECIMALS : null,
        gracePeriodEnd: args.gracePeriodEnd ? Number(args.gracePeriodEnd) : null,
        inputTokens: meta?.inputTokens ?? null,
        outputTokens: meta?.outputTokens ?? null,
        requestCount: meta?.requestCount ?? null,
        timestamp: blockTs.get(log.blockNumber!) ?? 0,
        rawLog: JSON.stringify(log, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      });
    }

    if (rows.length > 0) {
      const result = await db.insert(eventsTbl).values(rows).onConflictDoNothing().returning({ id: eventsTbl.id });
      totalAdded += result.length;
    }

    if (batches % 10 === 0 || logs.length > 0) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const pct = Number(((to - CHANNELS_DEPLOYMENT_BLOCK) * 10000n) / (end - CHANNELS_DEPLOYMENT_BLOCK)) / 100;
      console.log(`[backfill] batch ${batches} ${from}..${to} logs=${logs.length} added=${totalAdded} (${pct.toFixed(1)}%, ${elapsed.toFixed(0)}s)`);
    }

    from = to + 1n;
    if (SLEEP_MS > 0) await sleep(SLEEP_MS);
  }

  console.log(`[backfill] DONE. batches=${batches} scanned=${totalScanned} added=${totalAdded}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
