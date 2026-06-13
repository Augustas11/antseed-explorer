// Acceptance for /api/models — shape contract + rate-limit header parity with
// /api/buyers (SPEC §11.13). The handler is called in-process: getModelUsage
// is mocked via a module override so the test doesn't need a live DB.

import assert from "node:assert/strict";
import Module from "node:module";

// Intercept lib/queries imports BEFORE the route module pulls them in so we
// can return a fixed ModelUsageSummary without standing up Neon.
const queriesPath = require.resolve("../lib/queries");
const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load;
const FIXTURE = {
  rows: [
    {
      service_key: "claude-opus-4-6",
      display: "Claude Opus 4.6",
      aliases: ["Claude Opus 4.6", "claude-opus-4-6"],
      service_ids: ["0xee31eb7f3bda7e9df766576bab017da8d4831b482e6c1d960f86525787dc7134"],
      amount_usdc: 1234.56,
      input_tokens: 8000,
      cached_input_tokens: 1000,
      output_tokens: 4000,
      requests: 7,
      channels: 2,
      buyers: 2,
      sellers: 1,
      provider_count: 3,
      min_price_in: 0.5,
      max_price_in: 1.0,
      min_price_out: 1.5,
      max_price_out: 2.0,
      tags: ["premium"] as const,
    },
  ],
  unmapped: { service_ids: 1, amount_usdc: 12.34, top: [{ service_id: "0xabc", amount_usdc: 12.34 }] },
  coverage: {
    decoded_settled_usdc: 1500,
    v2_attributed_usdc: 1234.56,
    v2_share: 0.82,
    unattributed_usdc: 265.44,
    pending_usdc: 5,
    prefix_blocked_usdc: 0,
  },
};
(Module as unknown as { _load: typeof originalLoad })._load = function (
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  const resolved =
    request.startsWith("./") || request.startsWith("../") || request.startsWith("@/")
      ? request
      : null;
  // Hot-patch the queries module when the route loads it.
  if (
    request === "@/lib/queries" ||
    (resolved && require.resolve(request, { paths: [(parent as { path?: string })?.path ?? ""] }) === queriesPath)
  ) {
    return {
      getModelUsage: async () => FIXTURE,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

// Also mock the rate limiter so we can exercise both the allowed and denied
// paths without standing up a DB-backed bucket store.
let rateLimitAllowed = true;
const rateLimitPath = require.resolve("../lib/rateLimit");
const mcpUsagePath = require.resolve("../lib/mcp-usage");
const trackedRoutes: string[] = [];
const realLoad = (Module as unknown as { _load: typeof originalLoad })._load;
(Module as unknown as { _load: typeof originalLoad })._load = function (
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "@/lib/rateLimit") {
    return {
      checkRateLimit: async () =>
        rateLimitAllowed
          ? { allowed: true as const }
          : { allowed: false as const, retryAfter: 42 },
      getClientIp: () => "127.0.0.1",
    };
  }
  if (request === "@/lib/mcp-usage") {
    return {
      trackMcpUsage: (_req: unknown, route: string) => {
        trackedRoutes.push(route);
      },
    };
  }
  return realLoad.call(this, request, parent, isMain);
};
// Silence unused-path warnings.
void rateLimitPath;
void mcpUsagePath;

async function main() {
  const { GET } = await import("../app/api/models/route");

  // Allowed path — assert ModelUsageSummary shape.
  {
    const req = new Request("http://localhost/api/models?sort=spend");
    const res = await GET(req as unknown as Parameters<typeof GET>[0]);
    assert.equal(res.status, 200, "expected 200 on allowed path");
    const body = (await res.json()) as typeof FIXTURE;
    assert.ok(Array.isArray(body.rows), "rows is array");
    assert.equal(body.rows[0]!.display, "Claude Opus 4.6");
    assert.equal(body.rows[0]!.service_key, "claude-opus-4-6");
    assert.ok(typeof body.coverage.v2_share === "number");
    assert.ok("prefix_blocked_usdc" in body.coverage);
    assert.ok(typeof body.unmapped.service_ids === "number");
    assert.equal(trackedRoutes[0], "models", "trackMcpUsage called with 'models'");
  }

  // Denied path — assert 429 + Retry-After matches /api/buyers convention.
  {
    rateLimitAllowed = false;
    const req = new Request("http://localhost/api/models");
    const res = await GET(req as unknown as Parameters<typeof GET>[0]);
    assert.equal(res.status, 429, "expected 429 on rate-limit denial");
    assert.equal(res.headers.get("Retry-After"), "42", "Retry-After header echoed");
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "rate_limit_exceeded");
  }

  console.log("✓ test-api-models");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
