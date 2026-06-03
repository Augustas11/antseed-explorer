import assert from "node:assert/strict";
import fs from "node:fs";
import { sanitizeDiemPoolSnapshot } from "../lib/diem";

const addressA = `0x${"a".repeat(40)}`;
const addressB = `0x${"b".repeat(40)}`;

assert.deepEqual(
  sanitizeDiemPoolSnapshot({
    addresses: [addressA.toUpperCase(), addressA, addressB],
    count: 99,
    exactAddresses: true,
  }),
  {
    addresses: [addressA, addressB],
    count: 2,
    exactAddresses: true,
  },
);

assert.deepEqual(
  sanitizeDiemPoolSnapshot({
    addresses: [addressA, "not-an-address"],
    count: 5,
    exactAddresses: false,
  }),
  {
    addresses: [],
    count: 5,
    exactAddresses: false,
  },
);

for (const count of [Number.NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  assert.equal(
    sanitizeDiemPoolSnapshot({
      addresses: [],
      count,
      exactAddresses: false,
    }),
    null,
  );
}

assert.equal(sanitizeDiemPoolSnapshot(null), null);
assert.equal(sanitizeDiemPoolSnapshot({ count: 1, addresses: null }), null);

const diemSource = fs.readFileSync("lib/diem.ts", "utf8");
assert.match(
  diemSource,
  /createPublicClientWithTimeout/,
  "DIEM live RPC path must use per-call timeout clients",
);
assert.match(
  diemSource,
  /createPublicClientWithTimeout\([\s\S]*?,\s*0,\s*\)/,
  "DIEM deadline clients must disable retries",
);
assert.doesNotMatch(
  diemSource,
  /await publicClient\.(readContract|getBlockNumber|getLogs|multicall)/,
  "DIEM live RPC awaits must not use the shared 8s+retry client directly",
);

console.log("DIEM snapshot sanitizer checks passed");
