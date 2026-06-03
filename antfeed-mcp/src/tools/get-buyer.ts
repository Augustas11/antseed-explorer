import type { ExplorerClient } from "../explorer.js";
import { ExplorerError } from "../explorer.js";
import { getBuyerSchema } from "../schemas.js";
import type { BuyerProfileResponse, BuyerScoreResponse } from "../schemas.js";
import type { ToolDef } from "./registry.js";

export const getBuyerTool: ToolDef = {
  name: "get_buyer",
  description:
    "Look up a single buyer by 0x address. Use when you have an address; for browsing the directory of sellers use list_providers. Returns trust score breakdown (volume/consistency/diversity/reliability), aggregate session stats, the last 20 recent settled sessions, and the buyer's top sellers by spend.",
  inputSchema: {
    type: "object",
    properties: {
      address: {
        type: "string",
        pattern: "^0x[0-9a-fA-F]{40}$",
        description: "Buyer's on-chain address (0x + 40 hex chars)",
      },
    },
    required: ["address"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
      qualified: { type: "boolean", description: "True when the buyer meets the network's Qualified threshold (≥3 unique sellers)." },
      trustScore: {
        type: "object",
        properties: {
          total: { type: "number" },
          breakdownAvailable: {
            type: "boolean",
            description: "False when the score endpoint degraded and component scores are unavailable.",
          },
          volume: { type: ["number", "null"] },
          consistency: { type: ["number", "null"] },
          diversity: { type: ["number", "null"] },
          reliability: { type: ["number", "null"] },
        },
        required: ["total", "breakdownAvailable", "volume", "consistency", "diversity", "reliability"],
      },
      sessions: {
        type: "object",
        properties: {
          total: { type: "integer" },
          settledUsdc: { type: "number" },
          monthlyVolume: {
            type: "array",
            items: {
              type: "object",
              properties: {
                month: { type: "string", description: "YYYY-MM" },
                sessions: { type: "integer" },
                volumeUsdc: { type: "number" },
              },
              required: ["month", "sessions", "volumeUsdc"],
            },
          },
        },
        required: ["total", "settledUsdc", "monthlyVolume"],
      },
      recentSessions: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            sessionId: { type: ["string", "null"], description: "channel_id (bytes32 hex) when present" },
            seller: { type: ["string", "null"], pattern: "^0x[0-9a-fA-F]{40}$" },
            service: { type: ["string", "null"], description: "Service identifier — not currently indexed; always null in v0.2." },
            status: { type: "string", description: "Event type (e.g. deposited, settled, ghost)." },
            usdc: { type: ["number", "null"] },
            timestamp: { type: ["string", "null"], description: "ISO timestamp" },
          },
          required: ["sessionId", "seller", "service", "status", "usdc", "timestamp"],
        },
      },
      topSellers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
            displayName: { type: ["string", "null"] },
            sessionCount: { type: "integer" },
            usdc: { type: "number" },
          },
          required: ["address", "sessionCount", "usdc"],
        },
      },
    },
    required: ["address", "qualified", "trustScore", "sessions", "recentSessions", "topSellers"],
    additionalProperties: false,
  },
  annotations: {
    title: "Get Buyer",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const RECENT_SESSIONS_CAP = 20;

function isScoreDegradable(code: string): boolean {
  return code === "RATE_LIMITED" || code === "EXPLORER_DOWN" || code.startsWith("EXPLORER_HTTP_5");
}

export async function getBuyer(raw: unknown, deps: { explorer: ExplorerClient }) {
  const input = getBuyerSchema.parse(raw);
  const addr = input.address.toLowerCase();

  const [profile, score] = await Promise.all([
    deps.explorer.getBuyerProfile(addr),
    deps.explorer.getBuyerScore(addr).catch((err) => {
      // /api/score has its own rate limit and can be flaky independently of
      // /api/buyers. Degrade to null on any explorer-side outage (rate-limit,
      // network, 5xx) so a score blip doesn't take down buyer lookups.
      // Profile failures stay fatal — without it we don't have a buyer.
      if (err instanceof ExplorerError && isScoreDegradable(err.code)) return null;
      throw err;
    }),
  ]);

  if (!profile) {
    throw new ExplorerError(
      "BUYER_NOT_FOUND",
      `Address ${input.address} has no indexed buyer activity. The explorer indexes addresses on first on-chain deposit.`,
    );
  }

  return shapeBuyer(profile, score);
}

function shapeBuyer(profile: BuyerProfileResponse, score: BuyerScoreResponse | null) {
  const p = profile.profile;
  const breakdown = score?.breakdown;
  const recent = profile.sessions.slice(0, RECENT_SESSIONS_CAP).map((s) => ({
    sessionId: s.channel_id ?? null,
    seller: s.seller_address ?? null,
    service: null,
    status: s.event_type,
    usdc: s.settled_amount_usdc ?? s.delta_usdc ?? null,
    timestamp: s.timestamp ? new Date(s.timestamp * 1000).toISOString() : null,
  }));
  const topSellers = profile.topSellers.map((t) => ({
    address: t.seller_address,
    displayName: t.seller_label ?? null,
    sessionCount: t.sessions,
    usdc: t.total_usdc,
  }));
  return {
    address: p.address,
    // Profile is the source of truth — it's the row the rest of this response
    // is derived from. Using the score endpoint's `qualified` here could
    // produce `qualified=true` next to `unique_sellers<3` from a stale snapshot.
    qualified: p.qualified === 1,
    trustScore: {
      total: breakdown?.total ?? p.trust_score,
      breakdownAvailable: Boolean(breakdown),
      volume: breakdown?.volume ?? null,
      consistency: breakdown?.consistency ?? null,
      diversity: breakdown?.diversity ?? null,
      reliability: breakdown?.reliability ?? null,
    },
    sessions: {
      total: p.total_sessions,
      settledUsdc: p.total_settled_usdc,
      monthlyVolume: profile.monthly.map((m) => ({
        month: m.month,
        sessions: m.sessions,
        volumeUsdc: m.volume,
      })),
    },
    recentSessions: recent,
    topSellers,
  };
}
