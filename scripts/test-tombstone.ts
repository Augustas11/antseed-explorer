// SPEC §11.8 — tombstone DELETEs.
//
// Insert orphan rows directly into channel_service_totals and
// daily_service_metrics, then run recomputeServiceMetadata() and assert the
// orphans were removed by the cst_tombstone / dsm_tombstone writable CTEs.

import "dotenv/config";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../lib/db";
import { recomputeServiceMetadata } from "../lib/serviceMetadata";
import {
  applyFixture,
  cleanupTestState,
  makeTxHash,
  makeChannelId,
  seedAlias,
  skipIfNoDb,
  skipIfTablesMissing,
} from "./_service-metadata-fixture";

const ORPHAN_CHANNEL = "0xch1d-orphan-tombstone-test";
const ORPHAN_SERVICE = "0xff00000000000000000000000000000000000000000000000000000000fffeed";

async function main() {
  if (skipIfNoDb("test-tombstone")) return;
  if (await skipIfTablesMissing("test-tombstone")) return;
  await cleanupTestState();
  const raw = `antseed-test-model-tombstone-${Date.now()}`;
  await seedAlias(raw);
  const channel = makeChannelId(3);

  try {
    await applyFixture({
      txHash: makeTxHash(20),
      logIndex: 0,
      channelId: channel,
      blockNumber: 300_000,
      timestamp: 1_700_500_000,
      deltaUsdc: 1,
      services: [
        {
          raw,
          cumulativeAmount: 1_000_000n,
          cumulativeInputTokens: 100n,
          cumulativeCachedInputTokens: 0n,
          cumulativeOutputTokens: 50n,
          cumulativeRequestCount: 1n,
        },
      ],
    });

    // Plant orphans.
    await db.execute(sql`
      INSERT INTO channel_service_totals (channel_id, service_id,
        cumulative_amount_usdc, cumulative_in_tokens, cumulative_cached_in_tokens,
        cumulative_out_tokens, cumulative_requests,
        last_block, last_log_index, last_ts)
      VALUES (${ORPHAN_CHANNEL}, ${ORPHAN_SERVICE},
        99, 99, 0, 99, 99, 999, 0, 1700000000)
      ON CONFLICT (channel_id, service_id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO daily_service_metrics (day, service_id,
        delta_amount_usdc, delta_in_tokens, delta_cached_in_tokens,
        delta_out_tokens, delta_requests)
      VALUES (CURRENT_DATE, ${ORPHAN_SERVICE}, 99, 99, 0, 99, 99)
      ON CONFLICT (day, service_id) DO NOTHING
    `);

    await recomputeServiceMetadata();

    const cstOrphan = await db.execute<Record<string, unknown>>(sql`
      SELECT COUNT(*)::int AS n FROM channel_service_totals
       WHERE channel_id = ${ORPHAN_CHANNEL} AND service_id = ${ORPHAN_SERVICE}
    `);
    assert.equal(Number(cstOrphan.rows[0]?.n ?? 0), 0, "CST orphan must be tombstoned");

    const dsmOrphan = await db.execute<Record<string, unknown>>(sql`
      SELECT COUNT(*)::int AS n FROM daily_service_metrics
       WHERE service_id = ${ORPHAN_SERVICE}
    `);
    assert.equal(Number(dsmOrphan.rows[0]?.n ?? 0), 0, "DSM orphan must be tombstoned");

    console.log("✓ test-tombstone");
  } finally {
    await db.execute(sql`
      DELETE FROM channel_service_totals
       WHERE channel_id = ${ORPHAN_CHANNEL} OR service_id = ${ORPHAN_SERVICE}
    `);
    await db.execute(sql`
      DELETE FROM daily_service_metrics WHERE service_id = ${ORPHAN_SERVICE}
    `);
    await cleanupTestState();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
