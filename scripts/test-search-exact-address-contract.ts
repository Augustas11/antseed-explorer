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

const lookupAddressSource = sourceBlock(
  queriesSource,
  "export async function lookupAddress",
  "// ---------------------------------------------------------------------------\n// SellerRow + seller queries",
);
const addressMatchesSource = sourceBlock(
  resolverSource,
  "async function addressMatches",
  "async function serviceMatches",
);

assert.match(
  lookupAddressSource,
  /FROM\s+provider_directory\s+WHERE\s+address\s+=\s+\$\{normalized\}\s+LIMIT\s+1/,
  "exact address lookup must include provider-directory sellers with no settled sessions",
);
assert.match(
  lookupAddressSource,
  /return\s+\{\s*type:\s*"seller",\s*address:\s*normalized\s*\}/,
  "provider-directory exact address fallback must return a seller match",
);
assert.match(
  addressMatchesSource,
  /href:\s*`\/\$\{result\.type\s+===\s+"buyer"\s+\?\s+"buyers"\s+:\s+"sellers"\}\/\$\{result\.address\}`/,
  "exact seller address matches must link to /sellers/:address",
);

console.log("Search exact address contract checks passed");
