// SPEC §11.7 — recompute invariants on a small dev fixture.
//
// We don't TRUNCATE the prod DB here (recomputeServiceMetadataAll is the
// destructive form; gating it behind ALLOW_DESTRUCTIVE_RECOMPUTE keeps it out
// of CI). Instead we apply a known fixture, run the rebuild, and assert the
// invariants on the test-isolated rows.

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
  type SettlementFixture,
} from "./_service-metadata-fixture";

const EPS = 1e-6;

async function main() {
  if (skipIfNoDb("test-recompute-invariants")) return;
  if (await skipIfTablesMissing("test-recompute-invariants")) return;

  await cleanupTestState();
  const raw = `antseed-test-model-invariants-${Date.now()}`;
  const serviceId = await seedAlias(raw);
  const channel = makeChannelId(2);

  // Two settlements on one channel-service:
  //   S1: cumulative 5 USDC, 1000 in / 500 out / 5 req, top-level delta 5
  //   S2: cumulative 9 USDC, 1500 in / 700 out / 8 req, top-level delta 4
  // Expected after rebuild:
  //   CST = (9 USDC, 1500 in, 700 out, 8 req)
  //   DSM(day) sum = same totals
  const settlements: SettlementFixture[] = [
    {
      txHash: makeTxHash(10),
      logIndex: 0,
      channelId: channel,
      blockNumber: 200_000,
      timestamp: 1_700_000_000,
      deltaUsdc: 5,
      services: [
        {
          raw,
          cumulativeAmount: 5_000_000n,
          cumulativeInputTokens: 1000n,
          cumulativeCachedInputTokens: 0n,
          cumulativeOutputTokens: 500n,
          cumulativeRequestCount: 5n,
        },
      ],
    },
    {
      txHash: makeTxHash(11),
      logIndex: 0,
      channelId: channel,
      blockNumber: 200_001,
      timestamp: 1_700_000_000 + 86_400, // next UTC day
      deltaUsdc: 4,
      services: [
        {
          raw,
          cumulativeAmount: 9_000_000n,
          cumulativeInputTokens: 1500n,
          cumulativeCachedInputTokens: 0n,
          cumulativeOutputTokens: 700n,
          cumulativeRequestCount: 8n,
        },
      ],
    },
  ];

  try {
    for (const s of settlements) await applyFixture(s);
    await recomputeServiceMetadata();

    const cst = await db.execute<Record<string, unknown>>(sql`
      SELECT cumulative_amount_usdc, cumulative_in_tokens, cumulative_out_tokens, cumulative_requests
        FROM channel_service_totals
       WHERE channel_id = ${channel} AND service_id = ${serviceId}
    `);
    const cstRow = cst.rows[0];
    assert.ok(cstRow, "CST row must exist");
    assert.ok(
      Math.abs(Number(cstRow.cumulative_amount_usdc) - 9) < EPS,
      `CST USDC must be 9 (got ${cstRow.cumulative_amount_usdc})`,
    );
    assert.equal(Number(cstRow.cumulative_in_tokens), 1500);
    assert.equal(Number(cstRow.cumulative_out_tokens), 700);
    assert.equal(Number(cstRow.cumulative_requests), 8);

    const dsm = await db.execute<Record<string, unknown>>(sql`
      SELECT SUM(delta_amount_usdc)::float AS amount_sum,
             SUM(delta_in_tokens)::bigint  AS in_sum,
             SUM(delta_out_tokens)::bigint AS out_sum,
             SUM(delta_requests)::bigint   AS req_sum
        FROM daily_service_metrics
       WHERE service_id = ${serviceId}
    `);
    const dsmRow = dsm.rows[0]!;
    assert.ok(
      Math.abs(Number(dsmRow.amount_sum) - Number(cstRow.cumulative_amount_usdc)) < EPS,
      `DSM SUM(amount) ≈ CST cumulative (DSM=${dsmRow.amount_sum} CST=${cstRow.cumulative_amount_usdc})`,
    );
    assert.equal(
      Number(dsmRow.in_sum),
      Number(cstRow.cumulative_in_tokens),
      "DSM SUM(in_tokens) = CST cumulative",
    );
    assert.equal(Number(dsmRow.out_sum), Number(cstRow.cumulative_out_tokens));
    assert.equal(Number(dsmRow.req_sum), Number(cstRow.cumulative_requests));

    // Per-settlement aggregate cap (SPEC §5.5 per_settlement_scale): when the
    // sum of per-service first-snapshot USDC deltas in ONE settlement exceeds
    // events.delta_usdc, every per-service delta in that settlement must be
    // proportionally scaled down to fit the top-level cap.
    //
    // Fixture: a fresh channel (no pre-v2 history → no zero-baseline), one
    // settlement with TWO services each claiming 10 USDC cumulative while the
    // top-level delta is only 6. Expected: each service's CST is scaled to
    // 3 USDC (6 * 10 / 20 = 3). Without proportional scaling each would
    // sit at the raw 10 USDC and CST sum would be 2x reality.
    const capRaw = `antseed-test-model-cap-${Date.now()}`;
    const capRawB = `antseed-test-model-cap-b-${Date.now()}`;
    const capChannel = makeChannelId(99);
    const capSidA = await seedAlias(capRaw);
    const capSidB = await seedAlias(capRawB);
    await applyFixture({
      txHash: makeTxHash(99),
      logIndex: 0,
      channelId: capChannel,
      blockNumber: 300_000,
      timestamp: 1_700_500_000 + 86_400 * 7,
      deltaUsdc: 6,
      services: [
        {
          raw: capRaw,
          cumulativeAmount: 10_000_000n,
          cumulativeInputTokens: 100n,
          cumulativeCachedInputTokens: 0n,
          cumulativeOutputTokens: 50n,
          cumulativeRequestCount: 1n,
        },
        {
          raw: capRawB,
          cumulativeAmount: 10_000_000n,
          cumulativeInputTokens: 100n,
          cumulativeCachedInputTokens: 0n,
          cumulativeOutputTokens: 50n,
          cumulativeRequestCount: 1n,
        },
      ],
    });
    await recomputeServiceMetadata();
    const cap = await db.execute<Record<string, unknown>>(sql`
      SELECT SUM(cumulative_amount_usdc)::float AS sum_usdc
        FROM channel_service_totals
       WHERE channel_id = ${capChannel} AND service_id IN (${capSidA}, ${capSidB})
    `);
    const sumUsdc = Number(cap.rows[0]?.sum_usdc ?? 0);
    assert.ok(
      Math.abs(sumUsdc - 6) < EPS,
      `proportional scale must bring two-service first-snapshot sum to delta_usdc (got ${sumUsdc}, expected 6)`,
    );

    console.log("✓ test-recompute-invariants");
  } finally {
    await cleanupTestState();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
