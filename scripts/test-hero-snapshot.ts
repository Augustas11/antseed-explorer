import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getHeroSnapshotStatus,
  validateHeroSnapshot,
  type HeroSnapshot,
  type HeroStats,
} from "../lib/heroSnapshot";

const stats: HeroStats = {
  totalRevenueUsdc: 12.5,
  recentRevenueUsdc: 10,
  priorRevenueUsdc: 5,
  totalTokens: 1234,
  totalTokensInput: 1000,
  totalTokensOutput: 234,
  recentTokens: 900,
  priorTokens: 450,
  totalPayingUsers: 8,
  recentPayingUsers: 5,
  priorPayingUsers: 2,
  usdcPayers: 6,
  antsClaimers: 3,
  diemPoolUsers: 1,
  diemExactAddresses: true,
};

const valid: HeroSnapshot = {
  at: 1_700_000_000_000,
  source: {
    lastSyncTs: 1_700_000_000_000,
    lastHeadBlock: 100,
    lastIndexedBlock: 99,
    lastIndexedBlockStats: 99,
    lastIndexedBlockAnts: 98,
    lastIndexedBlockEmissions: 97,
    diemSnapshotAt: 1_700_000_000_000,
    diemExactAddresses: true,
  },
  stats,
  sparklines: [
    {
      day: "2026-06-03",
      revenue: 1.25,
      tokens: 100,
      paying_users: 3,
    },
  ],
};

assert.deepEqual(validateHeroSnapshot(valid), valid);
assert.deepEqual(getHeroSnapshotStatus(valid, valid.at + 60_000), {
  stale: false,
  reason: "fresh",
});
assert.equal(
  getHeroSnapshotStatus(
    {
      ...valid,
      source: {
        ...valid.source,
        lastSyncTs: valid.at - 31 * 60_000,
      },
    },
    valid.at,
  ).stale,
  true,
);
assert.equal(validateHeroSnapshot(null), null);
assert.equal(validateHeroSnapshot({ at: valid.at, stats, sparklines: null }), null);
assert.equal(
  validateHeroSnapshot({
    at: valid.at,
    stats: { ...stats, totalTokens: Number.NaN },
    sparklines: valid.sparklines,
  }),
  null,
);
assert.equal(
  validateHeroSnapshot({
    at: valid.at,
    stats,
    sparklines: [{ day: "not-a-day", revenue: 1, tokens: 1, paying_users: 1 }],
  }),
  null,
);

const queries = readFileSync("lib/queries.ts", "utf8");
assert.doesNotMatch(
  queries,
  /emptyHeroStats|emptyHeroSparklines/,
  "missing hero snapshots must not be converted into zero-valued snapshots",
);

const page = readFileSync("app/page.tsx", "utf8");
assert.match(page, /Snapshot pending refresh/);
assert.match(page, /Snapshot stale; refresh pending/);
assert.match(page, /value=\{hero \? fmtUsd\(hero\.totalRevenueUsdc\) : "—"\}/);
assert.match(page, /value=\{hero \? fmtCompact\(hero\.totalTokens\) : "—"\}/);
assert.match(page, /diemExactAddresses/);
assert.match(page, /Approximate wallets/);

console.log("Hero snapshot checks passed");
