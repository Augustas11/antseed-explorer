// Shared fixture helpers for the per-model attribution acceptance tests.
// Each test uses a unique tx_hash prefix to avoid colliding with real data
// and cleans up after itself in a finally block.

import { sql } from "drizzle-orm";
import { db } from "../lib/db";
import { applyDecodedSettlement } from "../lib/serviceMetadata";
import { serviceIdOf } from "../lib/metadata";
import { encodeAbiParameters } from "viem";
import { V2_PARAMS } from "../lib/metadata";

export const TEST_PREFIX = "0xfff10000";

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function skipIfNoDb(label: string): boolean {
  if (isDbConfigured()) return false;
  console.log(`✓ ${label} (skipped — DATABASE_URL unset)`);
  return true;
}

// Probes for the v2 attribution tables. If migrations 0012-0016 haven't been
// applied (test:contracts on a stale DB or CI without the new schema), skip
// the test cleanly. Saves us from a flood of "relation does not exist" stack
// traces in the test:contracts log.
export async function skipIfTablesMissing(label: string): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1 FROM settlement_service_snapshots LIMIT 0`);
    await db.execute(sql`SELECT 1 FROM channel_service_totals LIMIT 0`);
    await db.execute(sql`SELECT 1 FROM daily_service_metrics LIMIT 0`);
    await db.execute(sql`SELECT 1 FROM service_id_aliases LIMIT 0`);
    return false;
  } catch (e) {
    console.log(
      `✓ ${label} (skipped — v2 attribution tables not migrated: ${(e as Error)?.message ?? e})`,
    );
    return true;
  }
}

export function makeTxHash(suffix: number): string {
  return `${TEST_PREFIX}${suffix.toString(16).padStart(56, "0")}`;
}

export function makeChannelId(suffix: number): string {
  return `0xch1d${suffix.toString(16).padStart(60, "0")}`;
}

export interface SettlementFixture {
  txHash: string;
  logIndex: number;
  channelId: string;
  blockNumber: number;
  timestamp: number;
  deltaUsdc: number;
  services: Array<{
    raw: string;
    cumulativeAmount: bigint;
    cumulativeInputTokens: bigint;
    cumulativeCachedInputTokens: bigint;
    cumulativeOutputTokens: bigint;
    cumulativeRequestCount: bigint;
  }>;
}

export function encodeV2Metadata(fixture: SettlementFixture): string {
  return encodeAbiParameters(V2_PARAMS, [
    2n,
    fixture.services.reduce((a, s) => a + s.cumulativeInputTokens, 0n),
    fixture.services.reduce((a, s) => a + s.cumulativeOutputTokens, 0n),
    fixture.services.reduce((a, s) => a + s.cumulativeRequestCount, 0n),
    fixture.services.map((s) => ({
      serviceId: serviceIdOf(s.raw),
      cumulativeAmount: s.cumulativeAmount,
      cumulativeInputTokens: s.cumulativeInputTokens,
      cumulativeCachedInputTokens: s.cumulativeCachedInputTokens,
      cumulativeOutputTokens: s.cumulativeOutputTokens,
      cumulativeRequestCount: s.cumulativeRequestCount,
    })),
  ]);
}

export async function insertSettledEvent(fixture: SettlementFixture): Promise<void> {
  const metadata = encodeV2Metadata(fixture);
  const rawLog = JSON.stringify({ args: { metadata, channelId: fixture.channelId } });
  await db.execute(sql`
    INSERT INTO events
      (tx_hash, log_index, block_number, event_type, channel_id, timestamp, delta_usdc, raw_log)
    VALUES (
      ${fixture.txHash},
      ${fixture.logIndex},
      ${fixture.blockNumber},
      'settled',
      ${fixture.channelId},
      ${fixture.timestamp},
      ${fixture.deltaUsdc},
      ${rawLog}
    )
    ON CONFLICT (tx_hash, log_index) DO UPDATE
      SET block_number = EXCLUDED.block_number,
          delta_usdc   = EXCLUDED.delta_usdc,
          raw_log      = EXCLUDED.raw_log
  `);
}

export async function insertPendingSettledEvent(opts: {
  txHash: string;
  logIndex: number;
  channelId: string;
  blockNumber: number;
  timestamp: number;
  deltaUsdc: number;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO events
      (tx_hash, log_index, block_number, event_type, channel_id, timestamp, delta_usdc, metadata_decode_status)
    VALUES (
      ${opts.txHash},
      ${opts.logIndex},
      ${opts.blockNumber},
      'settled',
      ${opts.channelId},
      ${opts.timestamp},
      ${opts.deltaUsdc},
      'pending'
    )
    ON CONFLICT (tx_hash, log_index) DO UPDATE
      SET block_number = EXCLUDED.block_number,
          delta_usdc   = EXCLUDED.delta_usdc,
          metadata_decode_status = EXCLUDED.metadata_decode_status
  `);
}

export async function flipEventTerminal(txHash: string, logIndex: number, status: string) {
  await db.execute(sql`
    UPDATE events
       SET metadata_decode_status = ${status}, metadata_decoded_at = ${Math.floor(Date.now() / 1000)}
     WHERE tx_hash = ${txHash} AND log_index = ${logIndex}
  `);
}

export async function applyFixture(fixture: SettlementFixture): Promise<void> {
  await insertSettledEvent(fixture);
  await applyDecodedSettlement({
    txHash: fixture.txHash,
    logIndex: fixture.logIndex,
    channelId: fixture.channelId,
    blockNumber: fixture.blockNumber,
    timestamp: fixture.timestamp,
    metadata: encodeV2Metadata(fixture),
  });
}

// Snapshot every CST + DSM row that touches this test's tx_hash prefix.
export async function snapshotTestState() {
  const sss = await db.execute<Record<string, unknown>>(sql`
    SELECT * FROM settlement_service_snapshots
     WHERE tx_hash LIKE ${TEST_PREFIX + "%"}
     ORDER BY tx_hash, log_index, service_id
  `);
  const cst = await db.execute<Record<string, unknown>>(sql`
    SELECT * FROM channel_service_totals
     WHERE channel_id LIKE '0xch1d%'
     ORDER BY channel_id, service_id
  `);
  return { sss: sss.rows, cst: cst.rows };
}

// Hard-delete every row this test family wrote.
export async function cleanupTestState(): Promise<void> {
  await db.execute(sql`
    DELETE FROM settlement_service_snapshots WHERE tx_hash LIKE ${TEST_PREFIX + "%"}
  `);
  await db.execute(sql`
    DELETE FROM channel_service_totals WHERE channel_id LIKE '0xch1d%'
  `);
  await db.execute(sql`
    DELETE FROM daily_service_metrics
     WHERE service_id IN (
       SELECT service_id FROM service_id_aliases
        WHERE raw_alias LIKE 'antseed-test-model-%'
     )
  `);
  await db.execute(sql`
    DELETE FROM events WHERE tx_hash LIKE ${TEST_PREFIX + "%"}
  `);
  await db.execute(sql`
    DELETE FROM service_id_aliases WHERE raw_alias LIKE 'antseed-test-model-%'
  `);
}

// Pre-seed the alias table so the rebuild's coverage CTE can attribute
// the test rows to a recognizable canonical key.
export async function seedAlias(raw: string): Promise<string> {
  const serviceId = serviceIdOf(raw);
  const now = Math.floor(Date.now() / 1000);
  await db.execute(sql`
    INSERT INTO service_id_aliases
      (service_id, raw_alias, canonical_key, display, first_seen_ts, last_seen_ts)
    VALUES (${serviceId}, ${raw}, ${raw}, ${raw}, ${now}, ${now})
    ON CONFLICT (service_id) DO UPDATE
      SET last_seen_ts = EXCLUDED.last_seen_ts
  `);
  return serviceId;
}
