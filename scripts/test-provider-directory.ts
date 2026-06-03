import assert from "node:assert/strict";
import { sanitizeProviderDirectoryPeer } from "../lib/indexer";

const now = 1_700_000_000_000;
const operatorHex = "a".repeat(40);
const contractHex = "b".repeat(40);

const services = Array.from({ length: 120 }, (_v, i) => `svc-${i}`);
const peer = sanitizeProviderDirectoryPeer(
  {
    peerId: `${operatorHex}extra-data-that-is-not-an-address`,
    sellerContract: `0x${contractHex}`,
    displayName: ` ${"Provider ".repeat(30)} `,
    region: ` ${"region".repeat(30)} `,
    trustScore: 999,
    providers: [
      {
        services: [
          "llm.chat",
          "llm.chat",
          "bad\u0000service",
          ...services,
        ],
        servicePricing: {
          "llm.chat": {
            inputUsdPerMillion: 1.25,
            outputUsdPerMillion: 2.5,
          },
          "svc-0": {
            inputUsdPerMillion: -1,
          },
          "svc-1": {
            inputUsdPerMillion: Number.POSITIVE_INFINITY,
          },
        },
      },
    ],
  },
  now,
);

assert.ok(peer);
assert.equal(peer.row.address, `0x${contractHex}`);
assert.equal(peer.row.operatorAddress, `0x${operatorHex}`);
assert.equal(peer.supersededOperator, `0x${operatorHex}`);
assert.equal(peer.row.trustScore, 100);
assert.equal(peer.row.updatedAt, now);
assert.ok(peer.row.displayName);
assert.ok(peer.row.displayName.length <= 120);
assert.ok(peer.row.region);
assert.ok(peer.row.region.length <= 80);

const parsedServices = JSON.parse(peer.row.services ?? "[]") as string[];
assert.equal(parsedServices.length, 100);
assert.equal(parsedServices[0], "llm.chat");
assert.equal(parsedServices.includes("bad\u0000service"), false);

const parsedPricing = JSON.parse(peer.row.pricing ?? "{}") as Record<string, unknown>;
assert.deepEqual(parsedPricing["llm.chat"], {
  inputUsdPerMillion: 1.25,
  outputUsdPerMillion: 2.5,
});
assert.equal("svc-0" in parsedPricing, false);
assert.equal("svc-1" in parsedPricing, false);

assert.equal(sanitizeProviderDirectoryPeer({ peerId: "not-hex" }, now), null);
assert.equal(sanitizeProviderDirectoryPeer({ peerId: `${"c".repeat(39)}` }, now), null);

const noContract = sanitizeProviderDirectoryPeer(
  { peerId: `${operatorHex}tail`, trustScore: -10, providers: [] },
  now,
);
assert.ok(noContract);
assert.equal(noContract.row.address, `0x${operatorHex}`);
assert.equal(noContract.row.operatorAddress, null);
assert.equal(noContract.supersededOperator, null);
assert.equal(noContract.row.trustScore, 0);
assert.equal(noContract.row.services, null);
assert.equal(noContract.row.pricing, null);

const controlText = sanitizeProviderDirectoryPeer(
  {
    peerId: `${operatorHex}tail`,
    displayName: "provider\nname",
    region: "us\u0007west",
    providers: [],
  },
  now,
);
assert.ok(controlText);
assert.equal(controlText.row.displayName, null);
assert.equal(controlText.row.region, null);

assert.equal(sanitizeProviderDirectoryPeer({ peerId: `${operatorHex}\ntrail` }, now), null);

console.log("Provider directory sanitizer checks passed");
