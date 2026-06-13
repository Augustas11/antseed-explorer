// SPEC §11.10 — pending-prefix gate.
//
// Insert a v2 snapshot at block N+1 plus a separate `settled` event at block N
// with status `pending`. Run recomputeServiceMetadata(). Assert the block-N+1
// snapshot is NOT included in CST/DSM (channel_pending_min gates it out).
// Flip block N to a terminal status, re-run, assert block-N+1 now appears.

import "dotenv/config";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../lib/db";
import { recomputeServiceMetadata } from "../lib/serviceMetadata";
import {
  applyFixture,
  cleanupTestState,
  flipEventTerminal,
  insertPendingSettledEvent,
  makeTxHash,
  makeChannelId,
  seedAlias,
  skipIfNoDb,
  skipIfTablesMissing,
} from "./_service-metadata-fixture";

async function main() {
  if (skipIfNoDb("test-pending-prefix-gate")) return;
  if (await skipIfTablesMissing("test-pending-prefix-gate")) return;

  await cleanupTestState();
  const raw = `antseed-test-model-prefix-${Date.now()}`;
  const serviceId = await seedAlias(raw);
  const channel = makeChannelId(4);
  const pendingTx = makeTxHash(30);
  const laterTx = makeTxHash(31);

  try {
    // Pending settled at block 100 — no metadata, status pending.
    await insertPendingSettledEvent({
      txHash: pendingTx,
      logIndex: 0,
      channelId: channel,
      blockNumber: 100_000,
      timestamp: 1_700_700_000,
      deltaUsdc: 0,
    });
    // Later v2 settled at block 200 with one service.
    await applyFixture({
      txHash: laterTx,
      logIndex: 0,
      channelId: channel,
      blockNumber: 100_001,
      timestamp: 1_700_700_000 + 60,
      deltaUsdc: 3,
      services: [
        {
          raw,
          cumulativeAmount: 3_000_000n,
          cumulativeInputTokens: 300n,
          cumulativeCachedInputTokens: 0n,
          cumulativeOutputTokens: 150n,
          cumulativeRequestCount: 2n,
        },
      ],
    });

    await recomputeServiceMetadata();

    // Assert block-200 snapshot is held out of CST while block-100 is pending.
    const blocked = await db.execute<Record<string, unknown>>(sql`
      SELECT COUNT(*)::int AS n FROM channel_service_totals
       WHERE channel_id = ${channel} AND service_id = ${serviceId}
    `);
    assert.equal(
      Number(blocked.rows[0]?.n ?? 0),
      0,
      "block-200 snapshot must be held out of CST while block-100 is pending",
    );

    // Flip block-100 to a terminal status — channel is now prefix-complete.
    await flipEventTerminal(pendingTx, 0, "empty");
    await recomputeServiceMetadata();

    const unblocked = await db.execute<Record<string, unknown>>(sql`
      SELECT COUNT(*)::int AS n FROM channel_service_totals
       WHERE channel_id = ${channel} AND service_id = ${serviceId}
    `);
    assert.equal(
      Number(unblocked.rows[0]?.n ?? 0),
      1,
      "block-200 snapshot must appear in CST after the prefix unblocks",
    );

    console.log("✓ test-pending-prefix-gate");
  } finally {
    await cleanupTestState();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
