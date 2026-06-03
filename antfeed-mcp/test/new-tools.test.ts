import { describe, expect, it, vi } from "vitest";
import { ExplorerClient, ExplorerError } from "../src/explorer.js";
import { networkStats } from "../src/tools/network-stats.js";
import { getBuyer } from "../src/tools/get-buyer.js";
import { dauTrend } from "../src/tools/dau-trend.js";
import { lookup } from "../src/tools/lookup.js";
import { listProviders } from "../src/tools/list-providers.js";
import { decodeCursor, encodeCursor, InvalidCursorError } from "../src/cursor.js";

const BASE = "https://example.test";
const TEST_UA = "antfeed-mcp/test";
const ADDR_A = "0xAAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA00";
const ADDR_B = "0xBBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbB00";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function makeExplorer(fetchImpl: typeof fetch) {
  return new ExplorerClient({ baseUrl: BASE, timeoutMs: 1000, fetchImpl, userAgent: TEST_UA });
}

// Dispatch the right stub response based on which upstream path was hit.
function routedFetch(routes: Record<string, () => Response>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, build] of Object.entries(routes)) {
      if (url.includes(pattern)) return build();
    }
    throw new Error(`unmocked URL: ${url}`);
  }) as unknown as typeof fetch;
}

describe("cursor", () => {
  it("round-trips offset", () => {
    expect(decodeCursor(encodeCursor(0))).toBe(0);
    expect(decodeCursor(encodeCursor(50))).toBe(50);
    expect(decodeCursor(encodeCursor(12345))).toBe(12345);
  });

  it("undefined cursor decodes to 0 (first page)", () => {
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor("")).toBe(0);
  });

  it("rejects malformed cursors with InvalidCursorError", () => {
    expect(() => decodeCursor("not-base64-json")).toThrow(InvalidCursorError);
    expect(() => decodeCursor(Buffer.from("not-json", "utf8").toString("base64url"))).toThrow(
      InvalidCursorError,
    );
    expect(() => decodeCursor(Buffer.from('{"o":-5}', "utf8").toString("base64url"))).toThrow(
      InvalidCursorError,
    );
    expect(() => decodeCursor(Buffer.from('{"o":"5"}', "utf8").toString("base64url"))).toThrow(
      InvalidCursorError,
    );
  });

  it("rejects offsets above the safety ceiling", () => {
    expect(decodeCursor(encodeCursor(100_000))).toBe(100_000);
    const huge = Buffer.from(JSON.stringify({ o: 999_999_999 }), "utf8").toString("base64url");
    expect(() => decodeCursor(huge)).toThrow(InvalidCursorError);
  });
});

describe("network_stats tool", () => {
  const STATS = {
    totalBuyers: 100,
    qualifiedBuyers: 30,
    totalVolumeUsdc: 12345.67,
    totalSessions: 500,
    totalGhosts: 5,
    lastSyncTs: 1_700_000_000,
    drift: { eventsUsdc: 12345.67, profilesUsdc: 12345.67, driftUsdc: 0 },
  };
  const GAS = { gwei: 0.4231 };
  const DAU_TODAY = [
    {
      day: new Date().toISOString().slice(0, 10),
      new: 5,
      existing: 25,
      total: 30,
      dau_buyers: 20,
      dau_sellers: 10,
    },
  ];

  it("merges stats + gas + today's DAU into structured snapshot", async () => {
    const fetchImpl = routedFetch({
      "/api/stats": () => jsonResponse(STATS),
      "/api/gas": () => jsonResponse(GAS),
      "/api/metrics/dau": () => jsonResponse(DAU_TODAY),
    });
    const explorer = makeExplorer(fetchImpl);
    const out = (await networkStats({}, { explorer })) as Record<string, unknown>;
    expect(out.revenueUsdc).toBe(12345.67);
    expect(out.dau).toBe(30);
    expect(out.drift).toBe(0);
    expect(out.gasGwei).toBeCloseTo(0.4231, 4);
    expect(typeof out.asOf).toBe("string");
    expect(out.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.partialFailures).toEqual([]);
  });

  it("degrades gas to null and reports partialFailures when /api/gas 500s", async () => {
    const fetchImpl = routedFetch({
      "/api/stats": () => jsonResponse(STATS),
      "/api/gas": () => new Response("boom", { status: 500 }),
      "/api/metrics/dau": () => jsonResponse(DAU_TODAY),
    });
    const explorer = makeExplorer(fetchImpl);
    const out = (await networkStats({}, { explorer })) as Record<string, unknown>;
    expect(out.revenueUsdc).toBe(12345.67);
    expect(out.dau).toBe(30);
    expect(out.gasGwei).toBeNull();
    expect(out.partialFailures).toEqual(["gas"]);
  });

  it("degrades stats to null when /api/stats fails — does not cascade to other fields", async () => {
    const fetchImpl = routedFetch({
      "/api/stats": () => new Response("boom", { status: 500 }),
      "/api/gas": () => jsonResponse(GAS),
      "/api/metrics/dau": () => jsonResponse(DAU_TODAY),
    });
    const explorer = makeExplorer(fetchImpl);
    const out = (await networkStats({}, { explorer })) as Record<string, unknown>;
    expect(out.revenueUsdc).toBeNull();
    expect(out.drift).toBeNull();
    expect(out.dau).toBe(30);
    expect(out.gasGwei).toBeCloseTo(0.4231, 4);
    expect(out.partialFailures).toEqual(["stats"]);
  });

  it("tolerates null gwei (fee estimation failure)", async () => {
    const fetchImpl = routedFetch({
      "/api/stats": () => jsonResponse(STATS),
      "/api/gas": () => jsonResponse({ gwei: null }),
      "/api/metrics/dau": () => jsonResponse(DAU_TODAY),
    });
    const explorer = makeExplorer(fetchImpl);
    const out = (await networkStats({}, { explorer })) as Record<string, unknown>;
    expect(out.gasGwei).toBeNull();
  });

  it("dau is null when DAU endpoint returns empty series", async () => {
    const fetchImpl = routedFetch({
      "/api/stats": () => jsonResponse(STATS),
      "/api/gas": () => jsonResponse(GAS),
      "/api/metrics/dau": () => jsonResponse([]),
    });
    const explorer = makeExplorer(fetchImpl);
    const out = (await networkStats({}, { explorer })) as Record<string, unknown>;
    expect(out.dau).toBeNull();
  });

  it("issues 3 parallel upstream calls", async () => {
    const fetchImpl = routedFetch({
      "/api/stats": () => jsonResponse(STATS),
      "/api/gas": () => jsonResponse(GAS),
      "/api/metrics/dau": () => jsonResponse(DAU_TODAY),
    });
    const explorer = makeExplorer(fetchImpl);
    await networkStats({}, { explorer });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });
});

describe("get_buyer tool", () => {
  const PROFILE = {
    profile: {
      address: ADDR_A.toLowerCase(),
      total_sessions: 12,
      total_settled_usdc: 99.5,
      unique_sellers: 4,
      ghost_sessions: 1,
      first_seen_ts: 1_700_000_000,
      last_seen_ts: 1_700_086_400,
      first_seen_block: 100,
      last_seen_block: 200,
      trust_score: 65,
      qualified: 1,
    },
    sessions: Array.from({ length: 25 }, (_, i) => ({
      tx_hash: `0x${(i + 1).toString(16).padStart(64, "0")}`,
      block_number: 1000 + i,
      event_type: i % 3 === 0 ? "ghost" : "settled",
      seller_address: ADDR_B,
      channel_id: `0x${(i + 100).toString(16).padStart(64, "0")}`,
      delta_usdc: 1.25,
      settled_amount_usdc: i % 3 === 0 ? null : 1.25,
      timestamp: 1_700_000_000 + i * 3600,
      seller_label: "Dark Signal",
    })),
    topSellers: [
      { seller_address: ADDR_B, sessions: 8, total_usdc: 50.0, seller_label: "Dark Signal" },
    ],
    monthly: [{ month: "2026-05", sessions: 12, volume: 99.5 }],
  };

  const SCORE = {
    address: ADDR_A.toLowerCase(),
    score: 65,
    tier: "developing",
    qualified: true,
    breakdown: {
      total: 65,
      volume: 18,
      consistency: 15,
      diversity: 22,
      reliability: 10,
      qualified: true,
    },
    stats: {
      totalSessions: 12,
      totalSettledUsdc: 99.5,
      uniqueSellers: 4,
      ghostSessions: 1,
      firstSeenBlock: 100,
      lastSeenBlock: 200,
    },
  };

  it("merges /api/buyers + /api/score and trims to 20 recent sessions", async () => {
    const fetchImpl = routedFetch({
      "/api/buyers/": () => jsonResponse(PROFILE),
      "/api/score/": () => jsonResponse(SCORE),
    });
    const explorer = makeExplorer(fetchImpl);
    const out = (await getBuyer({ address: ADDR_A }, { explorer })) as Record<string, any>;
    expect(out.address).toBe(ADDR_A.toLowerCase());
    expect(out.qualified).toBe(true);
    expect(out.trustScore.total).toBe(65);
    expect(out.trustScore.volume).toBe(18);
    expect(out.trustScore.diversity).toBe(22);
    expect(out.sessions.total).toBe(12);
    expect(out.sessions.settledUsdc).toBe(99.5);
    expect(out.sessions.monthlyVolume[0]).toEqual({
      month: "2026-05",
      sessions: 12,
      volumeUsdc: 99.5,
    });
    expect(out.recentSessions).toHaveLength(20);
    expect(out.recentSessions[0].seller).toBe(ADDR_B);
    expect(out.recentSessions[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.recentSessions[0].service).toBeNull();
    expect(out.topSellers[0]).toEqual({
      address: ADDR_B,
      displayName: "Dark Signal",
      sessionCount: 8,
      usdc: 50.0,
    });
  });

  it("BUYER_NOT_FOUND when /api/buyers 404s", async () => {
    const fetchImpl = routedFetch({
      "/api/buyers/": () => new Response("not found", { status: 404 }),
      "/api/score/": () => jsonResponse(SCORE),
    });
    const explorer = makeExplorer(fetchImpl);
    await expect(getBuyer({ address: ADDR_A }, { explorer })).rejects.toMatchObject({
      code: "BUYER_NOT_FOUND",
    });
  });

  it("degrades gracefully when /api/score is rate-limited", async () => {
    const fetchImpl = routedFetch({
      "/api/buyers/": () => jsonResponse(PROFILE),
      "/api/score/": () => new Response("limit", { status: 429 }),
    });
    const explorer = makeExplorer(fetchImpl);
    const out = (await getBuyer({ address: ADDR_A }, { explorer })) as Record<string, any>;
    // Falls back to profile.trust_score when breakdown is unavailable.
    expect(out.trustScore.total).toBe(65);
    expect(out.trustScore.breakdownAvailable).toBe(false);
    expect(out.trustScore.volume).toBeNull();
    expect(out.trustScore.consistency).toBeNull();
    expect(out.trustScore.diversity).toBeNull();
    expect(out.trustScore.reliability).toBeNull();
  });

  it("INVALID_INPUT on non-hex address", async () => {
    const explorer = makeExplorer(vi.fn() as unknown as typeof fetch);
    await expect(getBuyer({ address: "not-hex" }, { explorer })).rejects.toMatchObject({
      name: "ZodError",
    });
  });
});

describe("dau_trend tool", () => {
  const SERIES = [
    { day: "2026-04-17", new: 2, existing: 8, total: 10, dau_buyers: 6, dau_sellers: 4 },
    { day: "2026-04-18", new: 3, existing: 9, total: 12, dau_buyers: 7, dau_sellers: 5 },
  ];

  it("re-shapes upstream rows to series shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SERIES));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const out = (await dauTrend(
      { from: "2026-04-17", to: "2026-04-18" },
      { explorer },
    )) as Record<string, any>;
    expect(out.from).toBe("2026-04-17");
    expect(out.to).toBe("2026-04-18");
    expect(out.granularity).toBe("day");
    expect(out.series).toEqual([
      { date: "2026-04-17", dau: 10, dauBuyers: 6, dauSellers: 4, newUsers: 2 },
      { date: "2026-04-18", dau: 12, dauBuyers: 7, dauSellers: 5, newUsers: 3 },
    ]);
  });

  it("passes from/to/granularity query params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SERIES));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    await dauTrend({ from: "2026-04-17", to: "2026-04-18" }, { explorer });
    const url = (fetchImpl.mock.calls[0]![0] as string);
    expect(url).toContain("/api/metrics/dau");
    expect(url).toContain("from=2026-04-17");
    expect(url).toContain("to=2026-04-18");
    expect(url).toContain("granularity=day");
  });

  it("defaults to a 30-day window when from/to omitted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const out = (await dauTrend({}, { explorer })) as Record<string, any>;
    const from = new Date(out.from + "T00:00:00Z");
    const to = new Date(out.to + "T00:00:00Z");
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    expect(days).toBe(29);
  });

  it("INVALID_INPUT on malformed date", async () => {
    const explorer = makeExplorer(vi.fn() as unknown as typeof fetch);
    await expect(dauTrend({ from: "yesterday" }, { explorer })).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("INVALID_INPUT on granularity=hour", async () => {
    const explorer = makeExplorer(vi.fn() as unknown as typeof fetch);
    await expect(dauTrend({ granularity: "hour" }, { explorer })).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("INVALID_INPUT when from > to", async () => {
    const explorer = makeExplorer(vi.fn() as unknown as typeof fetch);
    await expect(
      dauTrend({ from: "2026-05-10", to: "2026-05-01" }, { explorer }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("INVALID_INPUT when window exceeds 366 days", async () => {
    const explorer = makeExplorer(vi.fn() as unknown as typeof fetch);
    await expect(
      dauTrend({ from: "2024-01-01", to: "2026-05-01" }, { explorer }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });
});

describe("get_buyer qualified isolation", () => {
  it("does not let score endpoint override profile.qualified=0", async () => {
    const profileNotQualified = {
      profile: {
        address: ADDR_A.toLowerCase(),
        total_sessions: 2,
        total_settled_usdc: 1,
        unique_sellers: 1,
        ghost_sessions: 0,
        first_seen_ts: 1,
        last_seen_ts: 2,
        first_seen_block: 100,
        last_seen_block: 200,
        trust_score: 5,
        qualified: 0,
      },
      sessions: [],
      topSellers: [],
      monthly: [],
    };
    // Score says qualified=true (stale) — profile must win.
    const scoreSaysQualified = {
      address: ADDR_A.toLowerCase(),
      score: 80,
      tier: "trusted",
      qualified: true,
      breakdown: {
        total: 80,
        volume: 20,
        consistency: 20,
        diversity: 20,
        reliability: 20,
        qualified: true,
      },
    };
    const fetchImpl = routedFetch({
      "/api/buyers/": () => jsonResponse(profileNotQualified),
      "/api/score/": () => jsonResponse(scoreSaysQualified),
    });
    const explorer = makeExplorer(fetchImpl);
    const out = (await getBuyer({ address: ADDR_A }, { explorer })) as Record<string, unknown>;
    expect(out.qualified).toBe(false);
  });
});

describe("list_providers cursor pagination", () => {
  const ROW = (addr: string, volume: number, updatedAt: number) => ({
    address: addr,
    displayName: `Seller ${addr.slice(0, 6)}`,
    region: "us-east",
    services: ["svc-a"],
    pricing: { "svc-a": { inputUsdPerMillion: 1.0, outputUsdPerMillion: 2.0 } },
    sessionCount: 10,
    totalVolumeUsdc: volume,
    ghostCount: 0,
    closedCount: 10,
    updatedAt,
  });

  it("returns nextCursor when more pages exist; encodes upstream offset", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        providers: [ROW(ADDR_A, 100, 1)],
        total: 5,
        limit: 1,
        offset: 0,
      }),
    );
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const out = (await listProviders({ limit: 1 }, { explorer })) as Record<string, any>;
    expect(out.providers).toHaveLength(1);
    expect(out.total).toBe(5);
    expect(out.nextCursor).toBeDefined();
    expect(decodeCursor(out.nextCursor)).toBe(1);
  });

  it("omits nextCursor on the final page", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        providers: [ROW(ADDR_A, 100, 1)],
        total: 1,
        limit: 50,
        offset: 0,
      }),
    );
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const out = (await listProviders({}, { explorer })) as Record<string, any>;
    expect(out.nextCursor).toBeUndefined();
  });

  it("uses cursor to advance to the next upstream offset", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        providers: [ROW(ADDR_B, 50, 2)],
        total: 2,
        limit: 1,
        offset: 1,
      }),
    );
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const cursor = encodeCursor(1);
    await listProviders({ limit: 1, cursor }, { explorer });
    const url = (fetchImpl.mock.calls[0]![0] as string);
    expect(url).toContain("offset=1");
  });

  it("rejects garbage cursor with INVALID_CURSOR", async () => {
    const fetchImpl = vi.fn();
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    await expect(listProviders({ cursor: "not-a-valid-cursor" }, { explorer })).rejects.toMatchObject({
      code: "INVALID_CURSOR",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("lookup cursor pagination", () => {
  const ROW = (addr: string, name: string) => ({
    address: addr,
    displayName: name,
    region: "us-east",
    services: ["svc-a"],
    pricing: {},
    sessionCount: 0,
    totalVolumeUsdc: 0,
    ghostCount: 0,
    closedCount: 0,
    updatedAt: 1,
  });

  it("paginates filtered matches via cursor", async () => {
    const matches = Array.from({ length: 5 }, (_, i) =>
      ROW(`0x${"a".repeat(38)}${i.toString(16).padStart(2, "0")}`, `match-${i}`),
    );
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => jsonResponse({ providers: matches, total: 5, limit: 1000, offset: 0 }));
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);
    const first = (await lookup({ query: "match", limit: 2 }, { explorer })) as Record<string, any>;
    expect(first.matches).toHaveLength(2);
    expect(first.totalMatched).toBe(5);
    expect(first.nextCursor).toBeDefined();

    const second = (await lookup(
      { query: "match", limit: 2, cursor: first.nextCursor },
      { explorer },
    )) as Record<string, any>;
    expect(second.matches).toHaveLength(2);
    expect(second.matches[0].displayName).toBe("match-2");
    expect(second.nextCursor).toBeDefined();

    const third = (await lookup(
      { query: "match", limit: 2, cursor: second.nextCursor },
      { explorer },
    )) as Record<string, any>;
    expect(third.matches).toHaveLength(1);
    expect(third.nextCursor).toBeUndefined();
  });
});
