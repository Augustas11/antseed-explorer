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
assert.equal(decodeMetadata(metadata([2n, 123n, 456n, 7n])), null);
assert.equal(decodeMetadata(metadata([1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 456n, 7n])), null);
assert.equal(decodeMetadata(metadata([1n, 123n, 456n, 2_147_483_648n])), null);
assert.equal(decodeMetadata("0xnot-hex"), null);
assert.equal(decodeMetadata("0x1234"), null);

console.log("Indexer metadata decoder checks passed");
