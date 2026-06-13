// Acceptance for lib/metadata.ts (SPEC §11.2-§11.4).
// Fixtures encoded with viem's encodeAbiParameters so the assertion is on the
// decoder's behavior under a known good byte image; the hex was also verified
// against the upstream ABI shape in AntSeed PR #653.

import assert from "node:assert/strict";
import { keccak256, stringToBytes } from "viem";
import { decodeMetadata, serviceIdOf } from "../lib/metadata";

// Pre-encoded via viem.encodeAbiParameters with V1_PARAMS:
//   version=1, cumIn=12345, cumOut=6789, cumReq=42
const V1_HEX =
  "0x0000000000000000000000000000000000000000000000000000000000000001" +
  "0000000000000000000000000000000000000000000000000000000000003039" +
  "0000000000000000000000000000000000000000000000000000000000001a85" +
  "000000000000000000000000000000000000000000000000000000000000002a";

// Pre-encoded via viem.encodeAbiParameters with V2_PARAMS:
//   version=2, cumIn=12345, cumOut=6789, cumReq=42, services=[
//     { id=serviceIdOf("Claude Opus 4.6"),
//       amount=1_000_000, in=8000, cachedIn=1000, out=4000, req=7 },
//     { id=serviceIdOf("Claude Sonnet 4.6"),
//       amount=500_000, in=4345, cachedIn=0, out=2789, req=53 },
//   ]
const V2_HEX =
  "0x0000000000000000000000000000000000000000000000000000000000000002" +
  "0000000000000000000000000000000000000000000000000000000000003039" +
  "0000000000000000000000000000000000000000000000000000000000001a85" +
  "000000000000000000000000000000000000000000000000000000000000002a" +
  "00000000000000000000000000000000000000000000000000000000000000a0" +
  "0000000000000000000000000000000000000000000000000000000000000002" +
  "ee31eb7f3bda7e9df766576bab017da8d4831b482e6c1d960f86525787dc7134" +
  "00000000000000000000000000000000000000000000000000000000000f4240" +
  "0000000000000000000000000000000000000000000000000000000000001f40" +
  "00000000000000000000000000000000000000000000000000000000000003e8" +
  "0000000000000000000000000000000000000000000000000000000000000fa0" +
  "0000000000000000000000000000000000000000000000000000000000000007" +
  "7d182d8fe85c9513b5060d0fe4ed462fa2d3bd256903ff2921762924802f3b37" +
  "000000000000000000000000000000000000000000000000000000000007a120" +
  "00000000000000000000000000000000000000000000000000000000000010f9" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000ae5" +
  "0000000000000000000000000000000000000000000000000000000000000023";

// Pre-encoded with two duplicate `serviceId` entries where each duplicate has
// a different per-counter max:
//   dup A: amount=999, in=10,  cachedIn=1, out=5,  req=3
//   dup B: amount=100, in=20,  cachedIn=7, out=50, req=11
// Expected coalesced row (per-counter independent max, SPEC §5.2):
//   amount=999, in=20,  cachedIn=7, out=50, req=11
const V2_DUP_HEX =
  "0x0000000000000000000000000000000000000000000000000000000000000002" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000a0" +
  "0000000000000000000000000000000000000000000000000000000000000002" +
  "77389a96a54f6f125880a8d924d26dcd95acf61060fcfce060249aa73578786d" +
  "00000000000000000000000000000000000000000000000000000000000003e7" +
  "000000000000000000000000000000000000000000000000000000000000000a" +
  "0000000000000000000000000000000000000000000000000000000000000001" +
  "0000000000000000000000000000000000000000000000000000000000000005" +
  "0000000000000000000000000000000000000000000000000000000000000003" +
  "77389a96a54f6f125880a8d924d26dcd95acf61060fcfce060249aa73578786d" +
  "0000000000000000000000000000000000000000000000000000000000000064" +
  "0000000000000000000000000000000000000000000000000000000000000014" +
  "0000000000000000000000000000000000000000000000000000000000000007" +
  "0000000000000000000000000000000000000000000000000000000000000032" +
  "000000000000000000000000000000000000000000000000000000000000000b";

function testEmpty() {
  assert.deepEqual(decodeMetadata("0x"), { version: null, reason: "empty" });
  assert.deepEqual(decodeMetadata(""), { version: null, reason: "empty" });
  assert.deepEqual(decodeMetadata(null), { version: null, reason: "empty" });
  assert.deepEqual(decodeMetadata(undefined), { version: null, reason: "empty" });
}

function testV1() {
  const d = decodeMetadata(V1_HEX);
  assert.equal(d.version, 1);
  if (d.version !== 1) throw new Error("type guard");
  assert.equal(d.cumIn, 12345n);
  assert.equal(d.cumOut, 6789n);
  assert.equal(d.cumReq, 42n);
}

function testV2() {
  const d = decodeMetadata(V2_HEX);
  assert.equal(d.version, 2);
  if (d.version !== 2) throw new Error("type guard");
  assert.equal(d.cumIn, 12345n);
  assert.equal(d.cumOut, 6789n);
  assert.equal(d.cumReq, 42n);
  assert.equal(d.services.length, 2);
  const opus = d.services.find(
    (s) => s.serviceId === serviceIdOf("Claude Opus 4.6"),
  );
  assert.ok(opus, "Opus entry missing");
  assert.equal(opus!.cumulativeAmount, 1_000_000n);
  assert.equal(opus!.cumulativeInputTokens, 8000n);
  assert.equal(opus!.cumulativeCachedInputTokens, 1000n);
  assert.equal(opus!.cumulativeOutputTokens, 4000n);
  assert.equal(opus!.cumulativeRequestCount, 7n);
}

function testGarbageNoThrow() {
  // 4 bytes is not a valid ABI-encoded uint256 — decoder must return
  // decode_failed, NOT throw.
  const d = decodeMetadata("0xdeadbeef");
  assert.deepEqual(d, { version: null, reason: "decode_failed" });
}

function testDuplicateServiceIdPerCounterMax() {
  const d = decodeMetadata(V2_DUP_HEX);
  assert.equal(d.version, 2);
  if (d.version !== 2) throw new Error("type guard");
  // Two duplicates collapse into one row.
  assert.equal(d.services.length, 1);
  const row = d.services[0]!;
  // Per-counter independent max per SPEC §5.2 / pass-9 #2.
  assert.equal(row.cumulativeAmount, 999n, "amount: max from dup A");
  assert.equal(row.cumulativeInputTokens, 20n, "in: max from dup B");
  assert.equal(row.cumulativeCachedInputTokens, 7n, "cached: max from dup B");
  assert.equal(row.cumulativeOutputTokens, 50n, "out: max from dup B");
  assert.equal(row.cumulativeRequestCount, 11n, "req: max from dup B");
}

function testServiceIdOfHexLooking() {
  // Acceptance §11.3: a service name that LOOKS like hex must still be hashed
  // as UTF-8 bytes, not parsed as hex. viem.toBytes() would treat "0xdeadbeef"
  // as 4 bytes of binary; stringToBytes treats it as a 10-byte ASCII string.
  const got = serviceIdOf("0xdeadbeef");
  const expected = keccak256(stringToBytes("0xdeadbeef"));
  assert.equal(got, expected);
  // Sanity: NOT equal to the hex-interpreted version.
  assert.notEqual(got, keccak256("0xdeadbeef" as `0x${string}`));
}

function testServiceIdOfClaudeOpusVector() {
  // Acceptance §11.4: matches the AntSeed SDK `id("Claude Opus 4.6")` vector.
  // The SDK's id() is keccak256(utf8(name.trim())); proven by recomputing.
  // The hardcoded hex is the canonical hash; if the SDK ever changes the
  // hashing function, this test catches the drift.
  const expected =
    "0xee31eb7f3bda7e9df766576bab017da8d4831b482e6c1d960f86525787dc7134" as const;
  assert.equal(serviceIdOf("Claude Opus 4.6"), expected);
  // Trims whitespace (PR #653 spec says `name.trim()` is canonical input).
  assert.equal(serviceIdOf("  Claude Opus 4.6  "), expected);
}

// Build a v2 payload with a single service where a chosen counter holds the
// supplied bigint. Used to test the safe-counter boundary at the decoder.
function makeV2WithCounter(amount: bigint): string {
  const sid = serviceIdOf("Boundary Model");
  return encodeAbiParametersTest(amount, sid);
}

function encodeAbiParametersTest(amount: bigint, sid: `0x${string}`): string {
  // Hand-built ABI encoding for: (uint256 version, uint256 cumIn, uint256
  // cumOut, uint256 cumReq, ServiceTotal[] services) with one ServiceTotal.
  const w = (v: bigint) => v.toString(16).padStart(64, "0");
  const head =
    w(2n) + // version
    w(0n) + // cumIn
    w(0n) + // cumOut
    w(0n) + // cumReq
    w(0xa0n); // offset to services tail
  const tail =
    w(1n) + // services.length
    sid.replace(/^0x/, "") +
    w(amount) + // cumulativeAmount — the boundary value
    w(0n) +
    w(0n) +
    w(0n) +
    w(0n);
  return `0x${head}${tail}`;
}

function testCounterAboveMaxSafe() {
  // 2^63-1 is Postgres signed bigint max, but Number(2^63-1) rounds UP above
  // it, so an INSERT with Number-coerced 2^63-1 would fail with overflow.
  // The decoder must terminate this as decode_failed BEFORE we reach the DB.
  const tooBig = 9_223_372_036_854_775_807n; // 2^63-1
  const d = decodeMetadata(makeV2WithCounter(tooBig));
  assert.deepEqual(
    d,
    { version: null, reason: "decode_failed" },
    "2^63-1 cumulativeAmount must terminate decode_failed (Number precision loss)",
  );
}

function testCounterAtMaxSafe() {
  // MAX_SAFE_INTEGER (2^53-1) — coercion via Number() is lossless here, so
  // the decoder should accept it. The actual stored USDC ($9 billion) is
  // beyond any realistic counter but proves the boundary semantics.
  const okBig = BigInt(Number.MAX_SAFE_INTEGER);
  const d = decodeMetadata(makeV2WithCounter(okBig));
  assert.equal(d.version, 2, "MAX_SAFE_INTEGER counter must decode cleanly");
}

testEmpty();
testV1();
testV2();
testGarbageNoThrow();
testDuplicateServiceIdPerCounterMax();
testServiceIdOfHexLooking();
testServiceIdOfClaudeOpusVector();
testCounterAboveMaxSafe();
testCounterAtMaxSafe();

console.log("✓ test-metadata-decode");
