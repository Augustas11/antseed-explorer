// One-shot historical backfill for AntseedDeposits events on Base.
// Patterned 1:1 on scripts/_backfill-channels.ts. Bypasses the production
// sync lock so the running cron can keep going. Idempotent via
// onConflictDoNothing on (tx_hash, log_index).
//
// Why: The cron path runs Deposits with a small per-tick deadline; to land
// the full 36+ days of history quickly we hit Base RPC directly with 9000-
// block batches. Required to populate daily_dau for the parity check.
//
// Run:
//   RPC_URL=https://mainnet.base.org npx tsx scripts/_backfill-deposits.ts

import "dotenv/config";
import { createPublicClient, http, type Log } from "viem";
import { base } from "viem/chains";
import { db } from "../lib/db";
import { events as eventsTbl } from "../lib/schema";
import {
  depositsAbi,
  ANTSEED_DEPOSITS_DEPLOYMENT_BLOCK,
  CONTRACTS,
  type EventType,
} from "../lib/antseed";

const RPC = process.env.RPC_URL || "https://mainnet.base.org";
const DEPOSITS = CONTRACTS.AntseedDeposits as `0x${string}`;
const BATCH = BigInt(process.env.BACKFILL_BATCH || "9000");
const SLEEP_MS = Number(process.env.BACKFILL_SLEEP_MS || "120");
const USDC_DECIMALS = 1_000_000;

const client = createPublicClient({ chain: base, transport: http(RPC) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mapEventType(name: string | undefined): EventType | null {
  switch (name) {
    case "Deposited":          return "deposited";
    case "WithdrawalExecuted": return "withdrawal_executed";
    default: return null;
  }
}

async function main() {
  console.log("[backfill-deposits] starting");
  console.log("[backfill-deposits] rpc=", RPC, " contract=", DEPOSITS);
  console.log("[backfill-deposits] deployment_block=", ANTSEED_DEPOSITS_DEPLOYMENT_BLOCK.toString());

  const headBlock = await client.getBlockNumber();
  const end = process.env.BACKFILL_END_BLOCK ? BigInt(process.env.BACKFILL_END_BLOCK) : headBlock;
  let from = process.env.BACKFILL_START_BLOCK
    ? BigInt(process.env.BACKFILL_START_BLOCK)
    : ANTSEED_DEPOSITS_DEPLOYMENT_BLOCK;
  console.log("[backfill-deposits] range=", from.toString(), "..", end.toString());

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
        address: DEPOSITS,
        events: depositsAbi as any,
        fromBlock: from,
        toBlock: to,
      });
    } catch (e: any) {
      console.warn(`[backfill-deposits] getLogs error ${from}..${to}:`, e?.message?.slice(0, 200));
      await sleep(2000);
      const half = (to - from) / 2n;
      if (half < 1n) { console.warn("[backfill-deposits] giving up on this block"); from = to + 1n; continue; }
      const subEnd = from + half;
      try {
        logs = await client.getLogs({ address: DEPOSITS, events: depositsAbi as any, fromBlock: from, toBlock: subEnd });
        from = subEnd + 1n;
      } catch (e2: any) {
        console.warn("[backfill-deposits] retry failed, skipping range:", e2?.message?.slice(0, 200));
        from = to + 1n;
        continue;
      }
    }

    totalScanned += Number(to - from + 1n);

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
        console.warn("[backfill-deposits] getBlock failed:", e?.message?.slice(0, 100));
      }
    }

    const rows: any[] = [];
    for (const log of logs as any[]) {
      const eventType = mapEventType(log.eventName);
      if (!eventType) continue;
      const args = log.args || {};
      const buyer = (args.buyer as string | undefined)?.toLowerCase() ?? null;
      const amount = args.amount != null ? Number(args.amount) / USDC_DECIMALS : null;
      rows.push({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: Number(log.blockNumber),
        eventType,
        buyerAddress: buyer,
        sellerAddress: null,
        channelId: null,
        maxAmountUsdc: eventType === "deposited" ? amount : null,
        deltaUsdc: null,
        refundUsdc: eventType === "withdrawal_executed" ? amount : null,
        settledAmountUsdc: null,
        cumulativeAmountUsdc: null,
        platformFeeUsdc: null,
        newDepositUsdc: null,
        gracePeriodEnd: null,
        inputTokens: null,
        outputTokens: null,
        requestCount: null,
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
      const denom = (end - ANTSEED_DEPOSITS_DEPLOYMENT_BLOCK) || 1n;
      const pct = Number(((to - ANTSEED_DEPOSITS_DEPLOYMENT_BLOCK) * 10000n) / denom) / 100;
      console.log(`[backfill-deposits] batch ${batches} ${from}..${to} logs=${logs.length} added=${totalAdded} (${pct.toFixed(1)}%, ${elapsed.toFixed(0)}s)`);
    }

    from = to + 1n;
    if (SLEEP_MS > 0) await sleep(SLEEP_MS);
  }

  console.log(`[backfill-deposits] DONE. batches=${batches} scanned=${totalScanned} added=${totalAdded}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
