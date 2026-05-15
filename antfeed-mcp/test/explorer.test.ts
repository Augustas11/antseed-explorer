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

function makeExplorer(fetchImpl: typeof fetch) {
  return new ExplorerClient({ baseUrl: BASE, timeoutMs: 1000, fetchImpl });
}

function makeBuyer(fetchImpl: typeof fetch) {
  return new BuyerClient({ baseUrl: BUYER_BASE, timeoutMs: 1000, fetchImpl });
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

  it("strips trailing slashes from baseUrl", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellersPage([], 0));
    const explorer = new ExplorerClient({
      baseUrl: `${BASE}///`,
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
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
    });
    await expect(explorer.listSellers({})).rejects.toMatchObject({ code: "EXPLORER_TOO_LARGE" });
  });
});

describe("lookup tool", () => {
  it("matches sellers by address substring (case-insensitive)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellersPage([SELLER_ROW, SELLER_ROW_2], 2));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const result = await lookup({ query: "bbbb" }, { explorer });
    expect(result.matched).toBe(1);
    expect(result.matches[0]!.peerId).toBe(ADDR_B);
  });

  it("respects limit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellersPage([SELLER_ROW, SELLER_ROW_2], 2));
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
  it("maps sort=score → /api/sellers?sort=volume&dir=desc", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellersPage([SELLER_ROW], 1));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const out = await listProviders({ sort: "score", limit: 20 }, { explorer });
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain("sort=volume");
    expect(url).toContain("dir=desc");
    expect(out.providers).toHaveLength(1);
    expect(out.providers[0]!.peerId).toBe(SELLER_ROW.address);
  });

  it("maps sort=recent → /api/sellers?sort=first_seen&dir=desc", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellersPage([], 0));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    await listProviders({ sort: "recent" }, { explorer });
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain("sort=first_seen");
  });

  it("INVALID_INPUT on bad sort", async () => {
    const explorer = makeExplorer(vi.fn() as unknown as typeof fetch);
    await expect(listProviders({ sort: "nope" }, { explorer })).rejects.toMatchObject({ name: "ZodError" });
  });
});

describe("get_pricing tool", () => {
  it("returns NOT_INDEXED placeholder with no network calls", async () => {
    const result = await getPricing({ peerId: ADDR_C, service: "code-auditor" });
    expect(result.status).toBe("NOT_INDEXED");
    expect(result.pricePerToken).toBeNull();
    expect(result.currency).toBe("USDC");
    expect(result.peerId).toBe(ADDR_C);
    expect(result.service).toBe("code-auditor");
  });

  it("INVALID_INPUT on non-hex peerId", async () => {
    await expect(getPricing({ peerId: "not-a-hex-address", service: "x" })).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("INVALID_INPUT on missing fields", async () => {
    await expect(getPricing({ peerId: ADDR_C })).rejects.toMatchObject({ name: "ZodError" });
  });
});

describe("get_session_status tool", () => {
  it("finds channel by id and formats", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => channelsPage([CHANNEL_ROW], 1));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const out = await getSessionStatus({ sessionId: CHANNEL_ROW.channel_id }, { explorer });
    expect(out.sessionId).toBe(CHANNEL_ROW.channel_id);
    expect(out.buyer).toBe(CHANNEL_ROW.buyer_address);
    expect(out.status).toBe("Settled");
    expect(out.settled).toBe(true);
  });

  it("is case-insensitive on the hex part of channel id", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => channelsPage([CHANNEL_ROW], 1));
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
    const fetchImpl = vi.fn().mockImplementation(async () => channelsPage([CHANNEL_ROW], 1));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const err = await getSessionStatus(
      { sessionId: "0x000000000000000000000000000000000000000000000000000000000000dead" },
      { explorer },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ExplorerError);
    expect(err).toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  it("SESSION_OUT_OF_RANGE when MAX_PAGES exhausted on a deep total", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      ...CHANNEL_ROW,
      channel_id: `0x${(i + 1).toString(16).padStart(64, "0")}`,
    }));
    const fetchImpl = vi.fn().mockImplementation(async () => channelsPage(fullPage, 10000));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const err = await getSessionStatus(
      { sessionId: "0x000000000000000000000000000000000000000000000000000000000000beef" },
      { explorer },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ExplorerError);
    expect(err).toMatchObject({ code: "SESSION_OUT_OF_RANGE" });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});

describe("lookup truncation flag", () => {
  it("sets truncated=true when explorer.total exceeds page size", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellersPage([SELLER_ROW, SELLER_ROW_2], 5000));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const out = await lookup({ query: "0x" }, { explorer });
    expect(out.truncated).toBe(true);
  });

  it("sets truncated=false when explorer.total <= page size", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellersPage([SELLER_ROW], 1));
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
    });
    await expect(createSession(goodInput, { buyer, maxDepositUsdc: 10 })).rejects.toMatchObject({
      code: "BUYER_TOO_LARGE",
    });
  });
});
