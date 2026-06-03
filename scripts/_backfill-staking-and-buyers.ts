// Combined one-shot backfill:
//
//  Phase 1 — Staking is quarantined. The live indexer now maintains
//  staked_balance through the idempotent ants_holder_deltas ledger; this
//  legacy script mutates ants_holders directly and must not be used for
//  staking backfills.
//
//  Phase 2 — Buyer profiles: recompute buyer_profile rows for every address
//  that ever sent a Deposited event (tx.from, post-backfill-deposits). Closes
//  the gap between /buyers (buyer_profiles count) and the paying-users USDC
//  payer count by creating zero-session profiles for depositors who never
//  opened a channel.
//
// Run:
//   RPC_URL=https://mainnet.base.org npx tsx scripts/_backfill-staking-and-buyers.ts

import "dotenv/config";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { sql } from "drizzle-orm";
import { db } from "../lib/db";
import { rawNumericString } from "../lib/sqlSafe";
import {
  ANTSEED_STAKING_DEPLOYMENT_BLOCK,
  CONTRACTS,
} from "../lib/antseed";
import { recomputeBuyers } from "../lib/indexer";

const RPC = process.env.RPC_URL || "https://mainnet.base.org";
const STAKING = CONTRACTS.AntseedStaking as `0x${string}`;
const BATCH = BigInt(process.env.BACKFILL_BATCH || "9000");
const SLEEP_MS = Number(process.env.BACKFILL_SLEEP_MS || "120");

const client = createPublicClient({ chain: base, transport: http(RPC) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Minimal single-event ABIs — avoids OR-topics filter which some RPCs reject
// when events have different numbers of indexed params (Staked has 2, Unstaked 1).
const stakedAbi = [{
  type: "event" as const,
  name: "Staked",
  inputs: [
    { indexed: true,  name: "seller",  type: "address" as const },
    { indexed: true,  name: "agentId", type: "uint256" as const },
    { indexed: false, name: "amount",  type: "uint256" as const },
  ],
}];

const unstakedAbi = [{
  type: "event" as const,
  name: "Unstaked",
  inputs: [
    { indexed: true,  name: "seller",  type: "address" as const },
    { indexed: false, name: "amount",  type: "uint256" as const },
    { indexed: false, name: "slashed", type: "uint256" as const },
  ],
}];

async function getLogs(abi: typeof stakedAbi | typeof unstakedAbi, from: bigint, to: bigint) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.getLogs({ address: STAKING, events: abi as any, fromBlock: from, toBlock: to });
    } catch (e: any) {
      const msg: string = e?.message || String(e);
      if (attempt < 2) {
        console.warn(`  getLogs retry ${attempt + 1}/2:`, msg.slice(0, 120));
        await sleep(1500 * (attempt + 1));
      } else {
        throw e;
      }
    }
  }
  return [];
}

// ─── Phase 1: staking ────────────────────────────────────────────────────────

async function backfillStaking() {
  console.log("\n[phase-1/staking] starting");
  console.log("[phase-1/staking] contract=", STAKING);
  console.log("[phase-1/staking] deployment_block=", ANTSEED_STAKING_DEPLOYMENT_BLOCK.toString());
  if (process.env.UNSAFE_LEGACY_STAKING_BACKFILL !== "1") {
    console.log("[phase-1/staking] SKIPPED: legacy direct staked_balance mutation is quarantined; live staking is ledger-backed via ants_holder_deltas");
    return 0;
  }

  const ledgerRows = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM ants_holder_deltas
    WHERE delta_kind = 'staked'
  `);
  const ledgerCount = Number(ledgerRows.rows[0]?.n ?? 0);
  if (ledgerCount > 0) {
    throw new Error(
      `unsafe staking backfill refused: ants_holder_deltas already has ${ledgerCount} staked ledger rows; do not mutate ants_holders directly`,
    );
  }

  // Reset cursor so the cron re-syncs from scratch if the script is killed mid-run.
  await db.execute(sql`DELETE FROM indexer_state WHERE key = 'last_indexed_block_staking'`);
  // Reset balances so re-runs are idempotent.
  await db.execute(sql`UPDATE ants_holders SET staked_balance = '0'`);
  console.log("[phase-1/staking] reset cursor + staked_balance");

  const headBlock = await client.getBlockNumber();
  const end = process.env.BACKFILL_END_BLOCK ? BigInt(process.env.BACKFILL_END_BLOCK) : headBlock;
  let from = process.env.BACKFILL_START_BLOCK
    ? BigInt(process.env.BACKFILL_START_BLOCK)
    : ANTSEED_STAKING_DEPLOYMENT_BLOCK;

  console.log("[phase-1/staking] range=", from.toString(), "..", end.toString());

  let totalEvents = 0;
  let batches = 0;
  const startedAt = Date.now();

  while (from <= end) {
    const to = from + BATCH - 1n > end ? end : from + BATCH - 1n;
    batches++;

    let stakedLogs: any[] = [];
    let unstakedLogs: any[] = [];

    try {
      [stakedLogs, unstakedLogs] = await Promise.all([
        getLogs(stakedAbi, from, to),
        getLogs(unstakedAbi, from, to),
      ]);
    } catch (e: any) {
      console.error(`[phase-1/staking] fatal getLogs error at ${from}..${to}:`, e?.message?.slice(0, 200));
      process.exit(1);
    }

    const logs = [...(stakedLogs as any[]), ...(unstakedLogs as any[])];

    if (logs.length > 0) {
      const deltas = new Map<string, bigint>();
      for (const log of logs) {
        const args = log.args || {};
        const addr = (args.seller as string | undefined)?.toLowerCase();
        if (!addr) continue;
        const amount = BigInt(args.amount ?? 0n);
        const prev = deltas.get(addr) ?? 0n;
        if (log.eventName === "Staked")   deltas.set(addr, prev + amount);
        if (log.eventName === "Unstaked") deltas.set(addr, prev - amount);
      }
      totalEvents += logs.length;

      const now = Math.floor(Date.now() / 1000);
      for (const [addr, delta] of deltas) {
        if (delta === 0n) continue;
        const deltaStr = delta.toString();
        const deltaLiteral = rawNumericString(deltaStr, "staking delta");
        await db.execute(sql`
          INSERT INTO ants_holders (address, balance, staked_balance, updated_at)
          VALUES (${addr}, '0', ${deltaLiteral}, ${now})
          ON CONFLICT (address) DO UPDATE SET
            staked_balance = GREATEST('0'::numeric, ants_holders.staked_balance + ${deltaLiteral}),
            updated_at = ${now}
        `);
      }
    }

    if (batches % 10 === 0 || logs.length > 0) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const denom = (end - ANTSEED_STAKING_DEPLOYMENT_BLOCK) || 1n;
      const pct = Number(((to - ANTSEED_STAKING_DEPLOYMENT_BLOCK) * 10000n) / denom) / 100;
      console.log(`[phase-1/staking] batch ${batches} ${from}..${to} events=${logs.length} total=${totalEvents} (${pct.toFixed(1)}%, ${elapsed.toFixed(0)}s)`);
    }

    from = to + 1n;
    if (SLEEP_MS > 0) await sleep(SLEEP_MS);
  }

  // Advance cursor only after full successful run.
  await db.execute(sql`
    INSERT INTO indexer_state (key, value) VALUES ('last_indexed_block_staking', ${end.toString()})
    ON CONFLICT (key) DO UPDATE SET value = ${end.toString()}
  `);

  console.log(`[phase-1/staking] DONE. batches=${batches} events=${totalEvents} cursor=${end}`);
  return totalEvents;
}

// ─── Phase 2: buyer profiles ─────────────────────────────────────────────────

async function backfillBuyerProfiles() {
  console.log("\n[phase-2/buyers] starting");

  const rows = await db.execute<{ buyer_address: string }>(sql`
    SELECT DISTINCT buyer_address
    FROM events
    WHERE event_type = 'deposited'
      AND buyer_address IS NOT NULL
  `);

  const addresses = rows.rows.map((r) => r.buyer_address);
  console.log(`[phase-2/buyers] found ${addresses.length} unique depositor addresses`);

  const startedAt = Date.now();
  for (let i = 0; i < addresses.length; i += 10) {
    const chunk = addresses.slice(i, i + 10);
    await recomputeBuyers(chunk);
    const pct = Math.min(100, ((i + chunk.length) / addresses.length * 100)).toFixed(0);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    console.log(`[phase-2/buyers] ${i + chunk.length}/${addresses.length} (${pct}%, ${elapsed}s)`);
  }

  console.log(`[phase-2/buyers] DONE. recomputed ${addresses.length} profiles`);
  return addresses.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[backfill] rpc=", RPC);

  const stakingEvents = await backfillStaking();
  const buyerProfiles = await backfillBuyerProfiles();

  console.log(`\n[backfill] ALL DONE. staking_events=${stakingEvents} buyer_profiles_recomputed=${buyerProfiles}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
