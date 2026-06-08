import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clockFromTime,
  DEFAULT_EPOCH_ZERO_TS,
  EPOCH_DURATION_PROBES,
  EPOCH_START_BY_NUMBER_PROBES,
  EPOCH_ZERO_TIMESTAMP_PROBES,
  SEVEN_DAYS,
} from "../lib/epoch";

const epochSource = readFileSync("lib/epoch.ts", "utf8");
const queriesSource = readFileSync("lib/queries.ts", "utf8");

assert.equal(DEFAULT_EPOCH_ZERO_TS, 1_775_692_800);
assert.equal(new Date(DEFAULT_EPOCH_ZERO_TS * 1000).toISOString(), "2026-04-09T00:00:00.000Z");
assert.equal(
  new Date((DEFAULT_EPOCH_ZERO_TS + 9 * SEVEN_DAYS) * 1000).toISOString(),
  "2026-06-11T00:00:00.000Z",
  "fallback epoch zero must calibrate epoch 8 end to 2026-06-11 UTC",
);

assert.deepEqual(
  [...EPOCH_DURATION_PROBES],
  ["epochDuration", "EPOCH_DURATION", "epochLength"],
  "duration probes must include known V2 spelling variants",
);
assert.deepEqual(
  [...EPOCH_ZERO_TIMESTAMP_PROBES],
  ["startTime", "genesisTimestamp", "epochStart"],
  "timestamp probes must include known V2 genesis/current-start variants",
);
assert.deepEqual(
  [...EPOCH_START_BY_NUMBER_PROBES],
  ["epochStart", "epochs"],
  "indexed boundary probes must include epochStart(uint256) and epochs(uint256)",
);

assert.match(
  epochSource,
  /getLatestClaimedEpochAnchor/,
  "epoch clock must use the indexed claim anchor before calibrated fallback",
);
assert.match(
  queriesSource,
  /export async function getLatestClaimedEpochAnchor/,
  "queries module must expose the latest claimed epoch anchor helper",
);
assert.match(
  queriesSource,
  /jsonb_array_elements_text\(\s*claim_rows\.raw_log::jsonb -> 'args' -> 'epochs'/,
  "claim anchor helper must read indexed EmissionsClaimed args.epochs",
);

const calibrationNow = Math.floor(Date.UTC(2026, 5, 8, 12, 0, 0) / 1000);
const clock = clockFromTime(SEVEN_DAYS, calibrationNow);
assert.equal(clock.currentEpoch, 8);
assert.equal(clock.durationSec, SEVEN_DAYS);
assert.ok(clock.durationSec > 0);
assert.ok(clock.endTs > clock.startTs);
assert.ok(clock.endTs > calibrationNow);

console.log("Epoch clock contract checks passed");
