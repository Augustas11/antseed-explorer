import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const queriesSource = readFileSync("lib/queries.ts", "utf8");
const resolverSource = readFileSync("lib/searchResolver.ts", "utf8");

function sourceBlock(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `${startNeedle} must remain discoverable`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `${endNeedle} must remain after ${startNeedle}`);
  return source.slice(start, end);
}

const buyerPrefixSource = sourceBlock(
  queriesSource,
  "export async function searchBuyersByPrefix",
  "export async function searchSellersByPrefix",
);
const sellerPrefixSource = sourceBlock(
  queriesSource,
  "export async function searchSellersByPrefix",
  "// ---------------------------------------------------------------------------\n// Provider directory",
);
const addressMatchesSource = sourceBlock(
  resolverSource,
  "async function addressMatches",
  "async function serviceMatches",
);

assert.match(
  buyerPrefixSource,
  /FROM\s+events/,
  "buyer prefix autocomplete must read depositor events",
);
assert.match(
  buyerPrefixSource,
  /event_type\s*=\s*'deposited'/,
  "buyer prefix autocomplete must only expose funded buyer wallets",
);
assert.match(
  buyerPrefixSource,
  /LIMIT\s+\$\{rawPositiveInteger\(safeLimit,\s*"buyer prefix limit"\)\}/,
  "buyer prefix autocomplete must apply the bounded resolver limit",
);
assert.match(
  sellerPrefixSource,
  /FROM\s+provider_directory/,
  "seller prefix autocomplete must read the precomputed provider directory",
);
assert.doesNotMatch(
  sellerPrefixSource,
  /\bFROM\s+events\b|\bGROUP\s+BY\b|COUNT\s*\(/,
  "seller prefix autocomplete must not aggregate events on the hot path",
);
assert.match(
  sellerPrefixSource,
  /LIMIT\s+\$\{rawPositiveInteger\(safeLimit,\s*"seller prefix limit"\)\}/,
  "seller prefix autocomplete must apply the bounded resolver limit",
);
assert.match(
  addressMatchesSource,
  /prefixMatch\[1\]\.length\s*<\s*4/,
  "address autocomplete must skip DB work for prefixes shorter than four hex chars",
);
assert.match(
  addressMatchesSource,
  /searchBuyersByPrefix\(normalized,\s*limit\)/,
  "address autocomplete must pass the resolver limit to buyer prefix search",
);
assert.match(
  addressMatchesSource,
  /searchSellersByPrefix\(normalized,\s*limit\)/,
  "address autocomplete must pass the resolver limit to seller prefix search",
);

console.log("Search prefix contract checks passed");
