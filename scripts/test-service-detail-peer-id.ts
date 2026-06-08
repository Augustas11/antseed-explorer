import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const queriesSource = readFileSync("lib/queries.ts", "utf8");
const servicePageSource = readFileSync("app/services/[name]/page.tsx", "utf8");

const start = queriesSource.indexOf("async function getServiceUncached");
const end = queriesSource.indexOf("export const getService", start);
assert.notEqual(start, -1, "getServiceUncached must remain discoverable");
assert.notEqual(end, -1, "getService export must remain after getServiceUncached");

const getServiceUncachedSource = queriesSource.slice(start, end);
assert.match(
  getServiceUncachedSource,
  /SELECT\s+address,\s+display_name,\s+peer_id,\s+services,\s+pricing\s+FROM\s+provider_directory/,
  "service detail query must select provider_directory.peer_id",
);
assert.match(
  getServiceUncachedSource,
  /peer_id:\s*provider\.peer_id\s*\?\?\s*null/,
  "service detail provider rows must carry selected peer_id into provider_details",
);
assert.match(
  servicePageSource,
  /peerId=\{cheapestProvider\?\.peer_id\}/,
  "service detail page must pass a provider peer_id into AgentSnippet",
);

console.log("Service detail peer_id contract checks passed");
