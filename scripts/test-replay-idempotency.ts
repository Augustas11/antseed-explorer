// SPEC §11.6 — replay idempotency.
//
// Applies the same decoded settlement twice and asserts byte-identical state
// (settlement_service_snapshots rows + events.metadata_decode_status). Then
// applies an OLDER (block, log_index) for the same (channel, service) after a
// newer one and asserts the rebuild produces the correct cumulative without
// double-counting or losing the older delta.

import "dotenv/config";
import assert from "node:assert/strict";
import {
  applyFixture,
  cleanupTestState,
  makeTxHash,
  makeChannelId,
  seedAlias,
  skipIfNoDb,
  skipIfTablesMissing,
  snapshotTestState,
  type SettlementFixture,
} from "./_service-metadata-fixture";
import { recomputeServiceMetadata } from "../lib/serviceMetadata";

async function main() {
  if (skipIfNoDb("test-replay-idempotency")) return;
  if (await skipIfTablesMissing("test-replay-idempotency")) return;
  const raw = `antseed-test-model-replay-${Date.now()}`;
  await cleanupTestState();
  await seedAlias(raw);
  try {
    const fixture: SettlementFixture = {
      txHash: makeTxHash(1),
      logIndex: 0,
      channelId: makeChannelId(1),
      blockNumber: 100_000,
      timestamp: 1_700_000_000,
      deltaUsdc: 10,
      services: [
        {
          raw,
          cumulativeAmount: 9_000_000n, // 9 USDC in 6-decimal units
          cumulativeInputTokens: 1000n,
          cumulativeCachedInputTokens: 0n,
          cumulativeOutputTokens: 500n,
          cumulativeRequestCount: 3n,
        },
      ],
    };

    await applyFixture(fixture);
    const state1 = await snapshotTestState();
    await applyFixture(fixture); // replay
    const state2 = await snapshotTestState();

    assert.deepEqual(
      state1.sss,
      state2.sss,
      "snapshots must be byte-identical after replay",
    );

    // Apply an OLDER (block, log_index) for the same (channel, service) — the
    // older row has a smaller cumulative since it represents an earlier point
    // in time. The rebuild must order by (block, log_index) and produce the
    // newer cumulative as the channel total.
    const older: SettlementFixture = {
      ...fixture,
      txHash: makeTxHash(2),
      logIndex: 0,
      blockNumber: 99_999,
      services: [
        {
          ...fixture.services[0]!,
          cumulativeAmount: 4_000_000n,
          cumulativeInputTokens: 500n,
          cumulativeOutputTokens: 200n,
          cumulativeRequestCount: 1n,
        },
      ],
    };
    await applyFixture(older);
    await recomputeServiceMetadata();
    const finalState = await snapshotTestState();

    const cstRow = finalState.cst.find((r) => (r.channel_id as string) === fixture.channelId);
    assert.ok(cstRow, "channel_service_totals must contain the test channel");
    // Newer snapshot's absolute = 9 USDC; older snapshot's = 4 USDC.
    // Final cumulative on the channel-service is the newer absolute (9 USDC).
    assert.equal(
      Number(cstRow.cumulative_amount_usdc),
      9,
      "channel_service_totals.cumulative_amount_usdc tracks the newer absolute",
    );
    assert.equal(Number(cstRow.cumulative_requests), 3);

    console.log("✓ test-replay-idempotency");
  } finally {
    await cleanupTestState();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
