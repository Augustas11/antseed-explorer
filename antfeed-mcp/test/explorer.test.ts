import { describe, expect, it, vi } from "vitest";
import { ExplorerClient, ExplorerError } from "../src/explorer.js";
import { lookup } from "../src/tools/lookup.js";
import { listProviders } from "../src/tools/list-providers.js";
import { getPricing } from "../src/tools/get-pricing.js";
import { getSessionStatus } from "../src/tools/get-session-status.js";
import { createSession } from "../src/tools/create-session.js";
import { BuyerClient, BuyerError } from "../src/buyer.js";

const BASE = "https://example.test";
const BUYER_BASE = "http://localhost:8377";

const ADDR_A = "0xAAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA00";
const ADDR_B = "0xBBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbB00";
const ADDR_C = "0xCCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcC00";
const CHANNEL_ID = "0xd310dd43193bd3c7511524b0a71d4ee232aa22f80afb3728207c5552d66e5d5e";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const TEST_UA = "antfeed-mcp/test";

function makeExplorer(fetchImpl: typeof fetch) {
  return new ExplorerClient({ baseUrl: BASE, timeoutMs: 1000, fetchImpl, userAgent: TEST_UA });
}

function makeBuyer(fetchImpl: typeof fetch) {
  return new BuyerClient({ baseUrl: BUYER_BASE, timeoutMs: 1000, fetchImpl, userAgent: TEST_UA });
}

const SELLER_ROW = {
  address: ADDR_A,
  unique_buyers: 5,
  total_sessions: 12,
  total_earned_usdc: 1.23,
  ghost_sessions: 0,
  first_seen_ts: 1_700_000_000,
  last_seen_ts: 1_700_086_400,
  first_seen_block: 100,
  last_seen_block: 200,
};

const SELLER_ROW_2 = {
  ...SELLER_ROW,
  address: ADDR_B,
  total_earned_usdc: 0.5,
  total_sessions: 4,
};

const CHANNEL_ROW = {
  channel_id: CHANNEL_ID,
  buyer_address: ADDR_A,
  seller_address: ADDR_B,
  state: "Settled",
  opened_block: 1000,
  last_block: 2000,
  opened_ts: 1_700_000_000,
  last_ts: 1_700_086_400,
  max_amount_usdc: 10,
  settled_amount_usdc: 7.5,
  total_delta_usdc: 7.5,
  event_count: 4,
};

const sellersPage = (sellers: typeof SELLER_ROW[], total: number) =>
  jsonResponse({ sellers, total, limit: 1000, offset: 0 });
const channelsPage = (channels: typeof CHANNEL_ROW[], total: number, offset = 0) =>
  jsonResponse({ channels, total, limit: 1000, offset });
const channelDetail = (channel: typeof CHANNEL_ROW | null) =>
  channel ? jsonResponse(channel) : jsonResponse({ error: "channel_not_found" }, { status: 404 });

const PROVIDER_ROW = {
  address: ADDR_A,
  displayName: "Dark Signal",
  region: "us-east",
  services: ["gpt-5.4", "gpt-5.5"],
  pricing: {
    "gpt-5.4": { inputUsdPerMillion: 0.21, outputUsdPerMillion: 0.84 },
    "gpt-5.5": { inputUsdPerMillion: 5.0, outputUsdPerMillion: 15.0 },
  },
  sessionCount: 3645,
  totalVolumeUsdc: 2821.08,
  ghostCount: 0,
  closedCount: 100,
  updatedAt: 1_700_000_000_000,
};

const PROVIDER_ROW_2 = {
  ...PROVIDER_ROW,
  address: ADDR_B,
  displayName: "Open Forge",
  services: ["deepseek-r1"],
  pricing: { "deepseek-r1": { inputUsdPerMillion: 0.0, outputUsdPerMillion: 1.05 } },
  totalVolumeUsdc: 945.16,
  sessionCount: 1065,
  updatedAt: 1_700_001_000_000,
};

const providersPage = (providers: typeof PROVIDER_ROW[], total: number, offset = 0) =>
  jsonResponse({ providers, total, limit: 1000, offset });

describe("ExplorerClient User-Agent header", () => {
  it("sends the configured User-Agent on fetches", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellersPage([], 0));
    const explorer = new ExplorerClient({
      baseUrl: BASE,
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      userAgent: "antfeed-mcp/9.9.9-test",
    });
    await explorer.listSellers({});
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["User-Agent"]).toBe("antfeed-mcp/9.9.9-test");
  });
});

describe("ExplorerClient URL construction", () => {
  it("listSellers hits /api/sellers with correct query params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellersPage([], 0));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    await explorer.listSellers({ offset: 5, limit: 20, sort: "volume", dir: "desc" });
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toBe(`${BASE}/api/sellers?offset=5&limit=20&sort=volume&dir=desc`);
  });

  it("listChannels hits /api/channels", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(channelsPage([], 0));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    await explorer.listChannels({ limit: 1000, sort: "last_activity", dir: "desc" });
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toBe(`${BASE}/api/channels?limit=1000&sort=last_activity&dir=desc`);
  });

  it("getChannel hits /api/channels/{id}", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(channelDetail(CHANNEL_ROW));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    await explorer.getChannel(CHANNEL_ROW.channel_id);
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toBe(`${BASE}/api/channels/${CHANNEL_ROW.channel_id}`);
  });

  it("strips trailing slashes from baseUrl", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellersPage([], 0));
    const explorer = new ExplorerClient({
      baseUrl: `${BASE}///`,
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      userAgent: TEST_UA,
    });
    await explorer.listSellers({});
    expect((fetchImpl.mock.calls[0]![0] as string).startsWith(`${BASE}/api/sellers`)).toBe(true);
  });
});

describe("ExplorerClient error paths", () => {
  it("404 → EXPLORER_HTTP_404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    await expect(explorer.listSellers({})).rejects.toMatchObject({ code: "EXPLORER_HTTP_404" });
  });

  it("500 → EXPLORER_HTTP_500", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    await expect(explorer.listSellers({})).rejects.toMatchObject({ code: "EXPLORER_HTTP_500" });
  });

  it("429 → RATE_LIMITED", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("limit", { status: 429 }));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    await expect(explorer.listSellers({})).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("malformed JSON → EXPLORER_INVALID_JSON", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    await expect(explorer.listSellers({})).rejects.toMatchObject({ code: "EXPLORER_INVALID_JSON" });
  });

  it("network error → EXPLORER_DOWN", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    await expect(explorer.listSellers({})).rejects.toMatchObject({ code: "EXPLORER_DOWN" });
  });

  it("abort → EXPLORER_DOWN", async () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchImpl = vi.fn().mockRejectedValue(err);
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    await expect(explorer.listSellers({})).rejects.toMatchObject({ code: "EXPLORER_DOWN" });
  });

  it("response shape mismatch → EXPLORER_BAD_RESPONSE", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ sellers: [{ address: "not-hex" }], total: 1, limit: 1, offset: 0 }));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    await expect(explorer.listSellers({})).rejects.toMatchObject({ code: "EXPLORER_BAD_RESPONSE" });
  });

  it("content-length over cap → EXPLORER_TOO_LARGE", async () => {
    const huge = "x".repeat(10);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(huge, {
        status: 200,
        headers: { "Content-Type": "application/json", "Content-Length": "10000000" },
      }),
    );
    const explorer = new ExplorerClient({
      baseUrl: BASE,
      timeoutMs: 1000,
      maxBytes: 100,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      userAgent: TEST_UA,
    });
    await expect(explorer.listSellers({})).rejects.toMatchObject({ code: "EXPLORER_TOO_LARGE" });
  });

  it("streamed body over cap → EXPLORER_TOO_LARGE", async () => {
    const big = "x".repeat(2000);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(big, { status: 200, headers: { "Content-Type": "application/json" } }));
    const explorer = new ExplorerClient({
      baseUrl: BASE,
      timeoutMs: 1000,
      maxBytes: 100,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      userAgent: TEST_UA,
    });
    await expect(explorer.listSellers({})).rejects.toMatchObject({ code: "EXPLORER_TOO_LARGE" });
  });
});

describe("lookup tool", () => {
  it("matches providers by address substring (case-insensitive)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(providersPage([PROVIDER_ROW, PROVIDER_ROW_2], 2));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const result = await lookup({ query: "bbbb" }, { explorer });
    expect(result.matched).toBe(1);
    expect(result.matches[0]!.peerId).toBe(ADDR_B);
  });

  it("matches providers by displayName", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(providersPage([PROVIDER_ROW, PROVIDER_ROW_2], 2));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const result = await lookup({ query: "dark" }, { explorer });
    expect(result.matched).toBe(1);
    expect(result.matches[0]!.displayName).toBe("Dark Signal");
  });

  it("matches providers by service name", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(providersPage([PROVIDER_ROW, PROVIDER_ROW_2], 2));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const result = await lookup({ query: "deepseek" }, { explorer });
    expect(result.matched).toBe(1);
    expect(result.matches[0]!.peerId).toBe(ADDR_B);
  });

  it("respects limit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(providersPage([PROVIDER_ROW, PROVIDER_ROW_2], 2));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const result = await lookup({ query: "0x", limit: 1 }, { explorer });
    expect(result.matched).toBe(1);
  });

  it("INVALID_INPUT on empty query", async () => {
    const explorer = makeExplorer(vi.fn() as unknown as typeof fetch);
    await expect(lookup({ query: "" }, { explorer })).rejects.toMatchObject({ name: "ZodError" });
  });
});

describe("list_providers tool", () => {
  it("hits /api/providers with sort=volume by default", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(providersPage([PROVIDER_ROW], 1));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const out = await listProviders({ limit: 20 }, { explorer });
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain("/api/providers");
    expect(url).toContain("sort=volume");
    expect(out.sort).toBe("volume");
  });

  it("passes score alias through to /api/providers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(providersPage([PROVIDER_ROW], 1));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const out = await listProviders({ sort: "score", limit: 20 }, { explorer });
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain("/api/providers");
    expect(url).toContain("sort=score");
    expect(out.providers).toHaveLength(1);
    expect(out.providers[0]!.peerId).toBe(PROVIDER_ROW.address);
    expect(out.providers[0]!.displayName).toBe("Dark Signal");
    expect(out.providers[0]!.services).toEqual(["gpt-5.4", "gpt-5.5"]);
    expect(out.providers[0]!.pricingSummary.minInputUsdPerMillion).toBe(0.21);
    expect(out.providers[0]!.pricingSummary.maxInputUsdPerMillion).toBe(5.0);
  });

  it("passes REST provider sorts through to /api/providers", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(providersPage([PROVIDER_ROW_2, PROVIDER_ROW], 2));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const out = await listProviders({ sort: "reputation" }, { explorer });
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain("sort=reputation");
    expect(out.sort).toBe("reputation");
    expect(out.providers[0]!.peerId).toBe(ADDR_B); // updatedAt = 1_700_001_000_000 (newer)
    expect(out.providers[1]!.peerId).toBe(ADDR_A);
  });

  it("INVALID_INPUT on bad sort", async () => {
    const explorer = makeExplorer(vi.fn() as unknown as typeof fetch);
    await expect(listProviders({ sort: "nope" }, { explorer })).rejects.toMatchObject({ name: "ZodError" });
  });

  it("accepts services with spaces (display-name style)", async () => {
    const row = {
      ...PROVIDER_ROW,
      services: ["Claude Sonnet 4.6", "GPT 5.4", "kimi-k2.6 FREE 100K TOKENS"],
      pricing: {},
    };
    const fetchImpl = vi.fn().mockResolvedValue(providersPage([row], 1));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const out = await listProviders({ sort: "score" }, { explorer });
    expect(out.providers).toHaveLength(1);
    expect(out.providers[0]!.services).toContain("Claude Sonnet 4.6");
  });
});

describe("get_pricing tool", () => {
  const sellerServicesResponse = (overrides: Partial<typeof PROVIDER_ROW> = {}) =>
    jsonResponse({
      address: PROVIDER_ROW.address,
      displayName: PROVIDER_ROW.displayName,
      region: PROVIDER_ROW.region,
      services: PROVIDER_ROW.services,
      pricing: PROVIDER_ROW.pricing,
      updatedAt: PROVIDER_ROW.updatedAt,
      ...overrides,
    });

  it("returns INDEXED with live pricing when service is offered + priced", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellerServicesResponse());
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const result = await getPricing({ peerId: ADDR_A, service: "gpt-5.4" }, { explorer });
    expect(result.status).toBe("INDEXED");
    expect(result.inputUsdPerMillion).toBe(0.21);
    expect(result.outputUsdPerMillion).toBe(0.84);
    expect(result.currency).toBe("USDC");
    expect(result.displayName).toBe("Dark Signal");
    expect(fetchImpl.mock.calls[0]![0]).toContain(`/api/sellers/${ADDR_A.toLowerCase()}/services`);
  });

  it("returns PROVIDER_NOT_INDEXED when explorer 404s the seller", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const result = await getPricing({ peerId: ADDR_C, service: "gpt-5.4" }, { explorer });
    expect(result.status).toBe("PROVIDER_NOT_INDEXED");
    expect(result.inputUsdPerMillion).toBeNull();
  });

  it("returns SERVICE_NOT_OFFERED when seller doesn't list the service", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellerServicesResponse());
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const result = await getPricing({ peerId: ADDR_A, service: "unknown-svc" }, { explorer });
    expect(result.status).toBe("SERVICE_NOT_OFFERED");
    expect(result.availableServices).toEqual(["gpt-5.4", "gpt-5.5"]);
  });

  it("returns PRICE_NOT_PUBLISHED when service listed but no price entry", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        sellerServicesResponse({
          services: ["mystery-svc"],
          pricing: {}, // no entry for mystery-svc
        } as Partial<typeof PROVIDER_ROW>),
      );
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const result = await getPricing({ peerId: ADDR_A, service: "mystery-svc" }, { explorer });
    expect(result.status).toBe("PRICE_NOT_PUBLISHED");
    expect(result.inputUsdPerMillion).toBeNull();
  });

  it("accepts seller services response containing display-name services with spaces", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sellerServicesResponse({
        services: ["Claude Sonnet 4.6", "gpt-5.4"],
        pricing: { "gpt-5.4": { inputUsdPerMillion: 0.21, outputUsdPerMillion: 0.84 } },
      } as Partial<typeof PROVIDER_ROW>),
    );
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const result = await getPricing({ peerId: ADDR_A, service: "gpt-5.4" }, { explorer });
    expect(result.status).toBe("INDEXED");
    expect(result.inputUsdPerMillion).toBe(0.21);
  });

  it("INVALID_INPUT on non-hex peerId", async () => {
    const explorer = makeExplorer(vi.fn() as unknown as typeof fetch);
    await expect(
      getPricing({ peerId: "not-a-hex-address", service: "x" }, { explorer }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("INVALID_INPUT on missing fields", async () => {
    const explorer = makeExplorer(vi.fn() as unknown as typeof fetch);
    await expect(getPricing({ peerId: ADDR_C }, { explorer })).rejects.toMatchObject({
      name: "ZodError",
    });
  });
});

describe("get_session_status tool", () => {
  it("finds channel by id and formats", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => channelDetail(CHANNEL_ROW));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const out = await getSessionStatus({ sessionId: CHANNEL_ROW.channel_id }, { explorer });
    expect(out.sessionId).toBe(CHANNEL_ROW.channel_id);
    expect(out.buyer).toBe(CHANNEL_ROW.buyer_address);
    expect(out.status).toBe("Settled");
    expect(out.settled).toBe(true);
  });

  it("is case-insensitive on the hex part of channel id", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => channelDetail(CHANNEL_ROW));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const mixedCase = "0x" + CHANNEL_ROW.channel_id.slice(2).toUpperCase();
    const out = await getSessionStatus({ sessionId: mixedCase }, { explorer });
    expect(out.sessionId).toBe(CHANNEL_ROW.channel_id);
  });

  it("INVALID_INPUT on non-hex sessionId", async () => {
    const fetchImpl = vi.fn();
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    await expect(getSessionStatus({ sessionId: "not-hex" }, { explorer })).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("SESSION_NOT_FOUND when not in index (single short page)", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => channelDetail(null));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const err = await getSessionStatus(
      { sessionId: "0x000000000000000000000000000000000000000000000000000000000000dead" },
      { explorer },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ExplorerError);
    expect(err).toMatchObject({ code: "SESSION_NOT_FOUND" });
  });
});

describe("lookup truncation flag", () => {
  it("sets truncated=true when explorer.total exceeds page size", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(providersPage([PROVIDER_ROW, PROVIDER_ROW_2], 5000));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const out = await lookup({ query: "0x" }, { explorer });
    expect(out.truncated).toBe(true);
  });

  it("sets truncated=false when explorer.total <= page size", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(providersPage([PROVIDER_ROW], 1));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const out = await lookup({ query: "0x" }, { explorer });
    expect(out.truncated).toBe(false);
  });
});

describe("create_session tool", () => {
  const goodInput = {
    providerPeerId: ADDR_B,
    service: "code-auditor",
    initialDepositUsdc: 1.0,
    initialMessage: "audit this",
  };
  const buyerOk = (extra: Record<string, unknown> = {}) =>
    jsonResponse({ sessionId: "s1", status: "Open", ...extra });

  it("forwards validated input as POST /sessions on buyer URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(buyerOk());
    const buyer = makeBuyer(fetchImpl as unknown as typeof fetch);
    const out = (await createSession(goodInput, { buyer, maxDepositUsdc: 10 })) as Record<string, unknown>;
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BUYER_BASE}/sessions`);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject(goodInput);
    expect(out.sessionId).toBe("s1");
  });

  it("rejects with DEPOSIT_CAP_EXCEEDED when deposit > cap", async () => {
    const fetchImpl = vi.fn();
    const buyer = makeBuyer(fetchImpl as unknown as typeof fetch);
    await expect(
      createSession({ ...goodInput, initialDepositUsdc: 100 }, { buyer, maxDepositUsdc: 10 }),
    ).rejects.toMatchObject({ code: "DEPOSIT_CAP_EXCEEDED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("INVALID_INPUT on non-hex providerPeerId", async () => {
    const fetchImpl = vi.fn();
    const buyer = makeBuyer(fetchImpl as unknown as typeof fetch);
    await expect(
      createSession(
        { providerPeerId: "0xnothex", service: "x", initialDepositUsdc: 1 },
        { buyer, maxDepositUsdc: 10 },
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("INVALID_INPUT when initialDepositUsdc <= 0", async () => {
    const fetchImpl = vi.fn();
    const buyer = makeBuyer(fetchImpl as unknown as typeof fetch);
    await expect(
      createSession({ ...goodInput, initialDepositUsdc: 0 }, { buyer, maxDepositUsdc: 10 }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("buyer 500 → BUYER_HTTP_500", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const buyer = makeBuyer(fetchImpl as unknown as typeof fetch);
    await expect(createSession(goodInput, { buyer, maxDepositUsdc: 10 })).rejects.toMatchObject({
      code: "BUYER_HTTP_500",
    });
  });

  it("buyer network error → BUYER_DOWN", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const buyer = makeBuyer(fetchImpl as unknown as typeof fetch);
    await expect(createSession(goodInput, { buyer, maxDepositUsdc: 10 })).rejects.toBeInstanceOf(BuyerError);
  });

  it("buyer bad response shape → BUYER_BAD_RESPONSE", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ sessionId: "ok", channelAddress: "not-hex" }));
    const buyer = makeBuyer(fetchImpl as unknown as typeof fetch);
    await expect(createSession(goodInput, { buyer, maxDepositUsdc: 10 })).rejects.toMatchObject({
      code: "BUYER_BAD_RESPONSE",
    });
  });

  it("oversized buyer response → BUYER_TOO_LARGE", async () => {
    const big = "x".repeat(2000);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(big, { status: 200, headers: { "Content-Type": "application/json" } }));
    const buyer = new BuyerClient({
      baseUrl: BUYER_BASE,
      timeoutMs: 1000,
      maxBytes: 100,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      userAgent: TEST_UA,
    });
    await expect(createSession(goodInput, { buyer, maxDepositUsdc: 10 })).rejects.toMatchObject({
      code: "BUYER_TOO_LARGE",
    });
  });
});
