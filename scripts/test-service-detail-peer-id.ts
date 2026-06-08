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
  getServiceUncachedSource,
  /pricing_service:\s*svc/,
  "service detail provider rows must preserve the raw service for the selected pricing entry",
);
assert.match(
  getServiceUncachedSource,
  /isBetterServicePricing\(svcPricing,\s*existing\.pricing\)/,
  "service detail pricing rows must be compared before selecting the snippet service alias",
);
assert.match(
  servicePageSource,
  /peerId=\{cheapestProvider\?\.peer_id\}/,
  "service detail page must pass a provider peer_id into AgentSnippet",
);
assert.match(
  servicePageSource,
  /const snippetService\s*=\s*cheapestProvider\?\.pricing_service\s*\?\?\s*cheapestProvider\?\.advertised_as\[0\]\s*\?\?\s*service\.name;/,
  "service detail snippet must prefer the cheapest provider's raw advertised service",
);
assert.match(
  servicePageSource,
  /service=\{snippetService\}/,
  "service detail page must pass the resolved raw service into AgentSnippet",
);
assert.doesNotMatch(
  servicePageSource,
  /service=\{service\.name\}/,
  "service detail page must not pass the canonical service slug directly into AgentSnippet",
);

console.log("Service detail peer_id contract checks passed");
