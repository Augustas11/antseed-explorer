import assert from "node:assert/strict";
import { decodeMetadata } from "../lib/indexer";

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function metadata(values: [bigint, bigint, bigint, bigint]): string {
  return `0x${values.map(word).join("")}`;
}

const valid = decodeMetadata(metadata([1n, 123n, 456n, 7n]));
assert.deepEqual(valid, {
  version: 1,
  inputTokens: 123,
  outputTokens: 456,
  requestCount: 7,
});

assert.equal(decodeMetadata(metadata([0n, 123n, 456n, 7n])), null);

// v2 settlements share the v1 aggregate prefix per SPEC §2; the events row
// must still pick up inputTokens/outputTokens/requestCount or the dashboard
// goes blank for post-v0.1.103 buyers.
const v2 = decodeMetadata(metadata([2n, 999n, 888n, 11n]));
assert.deepEqual(v2, {
  version: 2,
  inputTokens: 999,
  outputTokens: 888,
  requestCount: 11,
});

assert.equal(decodeMetadata(metadata([3n, 123n, 456n, 7n])), null);
assert.equal(decodeMetadata(metadata([1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 456n, 7n])), null);
assert.equal(decodeMetadata(metadata([1n, 123n, 456n, 2_147_483_648n])), null);
assert.equal(decodeMetadata("0xnot-hex"), null);
assert.equal(decodeMetadata("0x1234"), null);

console.log("Indexer metadata decoder checks passed");
