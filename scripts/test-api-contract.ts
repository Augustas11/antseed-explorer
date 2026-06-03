import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { GET as getOpenApi } from "../app/api/openapi.json/route";
import {
  BuyerProfileResponseZ,
  BuyerScoreResponseZ,
  BuyersPageZ,
  ChannelRowZ,
  ChannelsPageZ,
  DauTrendResponseZ,
  GasResponseZ,
  listProvidersSchema,
  NetworkStatsResponseZ,
  PROVIDER_DEFAULT_SORT as MCP_PROVIDER_DEFAULT_SORT,
  PROVIDER_SORTS as MCP_PROVIDER_SORTS,
  ProvidersPageZ,
  SellerServicesResponseZ,
  SellersPageZ,
} from "../antfeed-mcp/src/schemas";
import {
  BUYER_SORTS,
  CHANNEL_SORTS,
  EXPORT_FORMATS,
  PROVIDER_DEFAULT_SORT,
  PROVIDER_SORTS,
  PUBLIC_OPENAPI_ROUTE_EXCLUSIONS,
  PUBLIC_RESPONSE_FIELDS,
  PublicResponseSchemaName,
  SELLER_SORTS,
  SORT_DIRECTIONS,
} from "../lib/publicApiContract";

const API_ROUTE_EXCLUSIONS = new Set<string>(PUBLIC_OPENAPI_ROUTE_EXCLUSIONS);

function routePathFromFile(file: string): string {
  const rel = path
    .relative(path.join(process.cwd(), "app/api"), file)
    .replace(/\/route\.ts$/, "")
    .replace(/\[([^\]]+)\]/g, "{$1}");
  return `/api/${rel}`;
}

interface ApiRouteFile {
  file: string;
  route: string;
}

function findApiRoutes(dir: string): ApiRouteFile[] {
  const out: ApiRouteFile[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...findApiRoutes(full));
    } else if (entry === "route.ts") {
      out.push({ file: full, route: routePathFromFile(full) });
    }
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

function exportedHttpMethods(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return ["get", "post"]
    .filter((method) =>
      new RegExp(`export\\s+async\\s+function\\s+${method}\\b`, "i").test(source),
    )
    .sort();
}

async function main() {
const spec = (await (await getOpenApi()).json()) as any;
const queriesSource = readFileSync("lib/queries.ts", "utf8");
const readContractSource = readFileSync("app/api/read-contract/route.ts", "utf8");
const apiRuntimeSource = readFileSync("scripts/test-api-runtime.ts", "utf8");
const cspRuntimeSource = readFileSync("scripts/test-csp-runtime.ts", "utf8");

const addressA = `0x${"a".repeat(40)}`;
const addressB = `0x${"b".repeat(40)}`;
const channelId = `0x${"c".repeat(64)}`;

const routeFiles = findApiRoutes(path.join(process.cwd(), "app/api"))
  .filter(({ route }) => !API_ROUTE_EXCLUSIONS.has(route));
const routePaths = routeFiles.map(({ route }) => route);
assert.deepEqual(
  Object.keys((spec as any).paths).sort(),
  routePaths,
  "OpenAPI paths must match non-excluded app/api routes",
);

for (const { file, route } of routeFiles) {
  assert.ok((spec as any).paths?.[route], `OpenAPI missing ${route}`);
  assert.deepEqual(
    Object.keys((spec as any).paths[route]).sort(),
    exportedHttpMethods(file),
    `OpenAPI methods must match exported handlers for ${route}`,
  );
}

function schemaProperties(name: string): Record<string, unknown> {
  const schema = (spec as any).components?.schemas?.[name];
  assert.ok(schema, `OpenAPI missing component schema ${name}`);
  return schema.properties ?? {};
}

function schemaRequired(name: string): string[] {
  const schema = (spec as any).components?.schemas?.[name];
  assert.ok(schema, `OpenAPI missing component schema ${name}`);
  return schema.required ?? [];
}

function assertSchemaFields(name: string, schema: any, expected: readonly string[]) {
  const properties = schema.properties ?? {};
  for (const key of expected) {
    assert.ok(key in properties, `OpenAPI schema ${name} missing property ${key}`);
  }
  assert.deepEqual(schema.required ?? [], [...expected], `OpenAPI schema ${name} required fields drifted`);
}

const componentResponseSchemas: PublicResponseSchemaName[] = [
  "BuyerRow",
  "SellerRow",
  "ChannelRow",
  "ServicePricing",
  "DirectoryProviderRow",
  "SellerServicesResponse",
  "BuyerSessionEvent",
  "BuyerSellerSummaryRow",
  "BuyerMonthlyVolumeRow",
  "BuyerProfileResponse",
  "ScoreResponse",
  "ProfileDrift",
  "StatsResponse",
];

for (const name of componentResponseSchemas) {
  assertSchemaFields(name, (spec as any).components.schemas[name], PUBLIC_RESPONSE_FIELDS[name]);
  assert.deepEqual(schemaRequired(name), [...PUBLIC_RESPONSE_FIELDS[name]]);
}

assert.deepEqual(
  (schemaProperties("ScoreResponse").breakdown as any).required,
  [...PUBLIC_RESPONSE_FIELDS.TrustScoreBreakdown],
);
assert.deepEqual(
  (schemaProperties("ScoreResponse").stats as any).required,
  [...PUBLIC_RESPONSE_FIELDS.ScoreStats],
);
assert.deepEqual(
  ((schemaProperties("StatsResponse").daily as any).items as any).required,
  [...PUBLIC_RESPONSE_FIELDS.StatsDailyRow],
);

function responseSchema(route: string, method = "get"): any {
  return (spec as any).paths[route][method].responses["200"].content["application/json"].schema;
}

assertSchemaFields("/api/buyers 200", responseSchema("/api/buyers"), PUBLIC_RESPONSE_FIELDS.BuyersPage);
assertSchemaFields("/api/sellers 200", responseSchema("/api/sellers"), PUBLIC_RESPONSE_FIELDS.SellersPage);
assertSchemaFields("/api/channels 200", responseSchema("/api/channels"), PUBLIC_RESPONSE_FIELDS.ChannelsPage);
assertSchemaFields("/api/providers 200", responseSchema("/api/providers"), PUBLIC_RESPONSE_FIELDS.ProvidersPage);
assertSchemaFields("/api/metrics/dau 200 item", responseSchema("/api/metrics/dau").items, PUBLIC_RESPONSE_FIELDS.DauDayRow);
assertSchemaFields("/api/gas 200", responseSchema("/api/gas"), PUBLIC_RESPONSE_FIELDS.GasResponse);
assertSchemaFields("/api/read-contract 200", responseSchema("/api/read-contract", "post"), PUBLIC_RESPONSE_FIELDS.ReadContractResponse);
assertSchemaFields("/api/sync 200", responseSchema("/api/sync", "post"), PUBLIC_RESPONSE_FIELDS.SyncResponse);

assert.match(readContractSource, /MAX_BODY_BYTES/);
assert.match(readContractSource, /readCappedJsonBody/);
assert.doesNotMatch(readContractSource, /req\.json\(\)/);
assert.doesNotMatch(apiRuntimeSource, /https:\/\/www\.antfeed\.org/);
assert.doesNotMatch(cspRuntimeSource, /https:\/\/www\.antfeed\.org/);

function queryEnum(route: string, name: string): unknown[] | undefined {
  return (spec as any).paths[route].get.parameters.find(
    (param: any) => param.name === name,
  )?.schema?.enum;
}

assert.deepEqual(queryEnum("/api/buyers", "sort"), [...BUYER_SORTS]);
assert.deepEqual(queryEnum("/api/sellers", "sort"), [...SELLER_SORTS]);
assert.deepEqual(queryEnum("/api/channels", "sort"), [...CHANNEL_SORTS]);
assert.deepEqual(queryEnum("/api/providers", "sort"), [...PROVIDER_SORTS]);
assert.deepEqual([...MCP_PROVIDER_SORTS], [...PROVIDER_SORTS]);
assert.equal(MCP_PROVIDER_DEFAULT_SORT, PROVIDER_DEFAULT_SORT);
for (const sort of PROVIDER_SORTS) {
  assert.equal(listProvidersSchema.parse({ sort }).sort, sort);
}
assert.deepEqual(queryEnum("/api/sellers", "dir"), [...SORT_DIRECTIONS]);
assert.deepEqual(queryEnum("/api/channels", "dir"), [...SORT_DIRECTIONS]);
assert.deepEqual(queryEnum("/api/buyers", "format"), [...EXPORT_FORMATS]);
assert.deepEqual(queryEnum("/api/sellers", "format"), [...EXPORT_FORMATS]);
assert.deepEqual(queryEnum("/api/channels", "format"), [...EXPORT_FORMATS]);

const getBuyerSessionsBody = queriesSource.match(
  /export async function getBuyerSessions[\s\S]*?\n}\n\nexport async function getBuyerMonthlyVolume/,
)?.[0];
assert.ok(getBuyerSessionsBody, "getBuyerSessions must remain discoverable to contract checks");
assert.match(
  getBuyerSessionsBody,
  /block_number:\s*Number\(e\.block_number\)/,
  "buyer detail sessions must serialize block_number as a number",
);
assert.match(
  getBuyerSessionsBody,
  /timestamp:\s*e\.timestamp != null \? Number\(e\.timestamp\) : null/,
  "buyer detail sessions must serialize timestamp as a number or null",
);

assert.deepEqual(schemaProperties("ScoreResponse").tier, {
  type: "string",
  enum: ["trusted", "developing", "new", "unknown"],
});

const buyer = {
  address: addressA,
  total_sessions: 2,
  total_settled_usdc: 12.5,
  unique_sellers: 1,
  ghost_sessions: 0,
  first_seen_block: 1,
  last_seen_block: 2,
  first_seen_ts: 1_700_000_000,
  last_seen_ts: 1_700_000_100,
  trust_score: 50,
  qualified: 0,
};

const seller = {
  address: addressB,
  unique_buyers: 1,
  total_sessions: 2,
  total_earned_usdc: 12.5,
  ghost_sessions: 0,
  first_seen_ts: 1_700_000_000,
  last_seen_ts: 1_700_000_100,
  first_seen_block: 1,
  last_seen_block: 2,
};

const channel = {
  channel_id: channelId,
  buyer_address: addressA,
  seller_address: addressB,
  state: "Settled",
  opened_block: 1,
  last_block: 2,
  opened_ts: 1_700_000_000,
  last_ts: 1_700_000_100,
  max_amount_usdc: 25,
  settled_amount_usdc: 12.5,
  total_delta_usdc: 12.5,
  event_count: 2,
};

const provider = {
  address: addressB,
  displayName: "Dark Signal",
  region: "us-east",
  services: ["llm.chat.gpt-5"],
  pricing: {
    "llm.chat.gpt-5": { inputUsdPerMillion: 0.21, outputUsdPerMillion: 5 },
  },
  sessionCount: 2,
  totalVolumeUsdc: 12.5,
  ghostCount: 0,
  closedCount: 1,
  updatedAt: 1_700_000_000_000,
  operatorAddress: null,
};

SellersPageZ.parse({ sellers: [seller], total: 1, limit: 100, offset: 0 });
BuyersPageZ.parse({ buyers: [buyer], total: 1, limit: 100, offset: 0 });
ChannelsPageZ.parse({ channels: [channel], total: 1, limit: 100, offset: 0 });
ChannelRowZ.parse(channel);
ProvidersPageZ.parse({ providers: [provider], total: 1, limit: 100, offset: 0 });
assert.throws(
  () =>
    ProvidersPageZ.parse({
      providers: [{ ...provider, operatorAddress: undefined }],
      total: 1,
      limit: 100,
      offset: 0,
    }),
  { name: "ZodError" },
  "MCP provider schema must require every public DirectoryProviderRow field",
);
SellerServicesResponseZ.parse({
  address: addressB,
  displayName: "Dark Signal",
  region: "us-east",
  services: ["llm.chat.gpt-5"],
  pricing: {
    "llm.chat.gpt-5": { inputUsdPerMillion: 0.21, outputUsdPerMillion: 5 },
  },
  updatedAt: 1_700_000_000_000,
});
NetworkStatsResponseZ.parse({
  totalBuyers: 1,
  qualifiedBuyers: 0,
  totalVolumeUsdc: 12.5,
  totalSessions: 2,
  totalGhosts: 0,
  lastSyncTs: 1_700_000_100,
  drift: { eventsUsdc: 12.5, profilesUsdc: 12.5, driftUsdc: 0 },
});
GasResponseZ.parse({ gwei: 0.0042 });
DauTrendResponseZ.parse([
  {
    day: "2026-06-03",
    new: 1,
    existing: 2,
    total: 3,
    dau_buyers: 2,
    dau_sellers: 1,
  },
]);
BuyerProfileResponseZ.parse({
  profile: buyer,
  sessions: [
    {
      tx_hash: `0x${"d".repeat(64)}`,
      block_number: 2,
      event_type: "settled",
      seller_address: addressB,
      channel_id: channelId,
      delta_usdc: 12.5,
      settled_amount_usdc: 12.5,
      timestamp: 1_700_000_100,
      seller_label: "Dark Signal",
    },
  ],
  topSellers: [
    {
      seller_address: addressB,
      sessions: 2,
      total_usdc: 12.5,
      seller_label: "Dark Signal",
    },
  ],
  monthly: [{ month: "2026-06", sessions: 2, volume: 12.5 }],
});
BuyerScoreResponseZ.parse({
  address: addressA,
  score: 50,
  tier: "developing",
  qualified: false,
  breakdown: {
    total: 50,
    volume: 10,
    consistency: 10,
    diversity: 10,
    reliability: 20,
    qualified: false,
  },
});

console.log("API contract checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
