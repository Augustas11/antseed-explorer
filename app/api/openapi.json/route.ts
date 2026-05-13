import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const spec = {
  openapi: "3.0.3",
  info: {
    title: "AntSeed Explorer API",
    version: "1.0.0",
    description:
      "REST API for the AntSeed Channels protocol on Base. Indexes buyer/seller payment channel events and computes trust scores.\n\n**Rate limits:** 60 req/min unauthenticated · 300 req/min with `X-Api-Key` header. Exceeded limits return `429` with a `Retry-After` header.\n\nGenerate a key at [/keys](/keys).",
    contact: { url: "https://www.antfeed.org" },
    license: { name: "MIT" },
  },
  servers: [{ url: "https://www.antfeed.org", description: "Production" }],
  components: {
    securitySchemes: {
      ApiKey: {
        type: "apiKey",
        in: "header",
        name: "X-Api-Key",
        description: "Optional. Raises rate limit from 60 to 300 req/min.",
      },
    },
    schemas: {
      BuyerRow: {
        type: "object",
        properties: {
          address: { type: "string", example: "0xabc123..." },
          total_sessions: { type: "integer", example: 12 },
          total_settled_usdc: { type: "number", example: 123.45 },
          unique_sellers: { type: "integer", example: 3 },
          ghost_sessions: { type: "integer", example: 1 },
          first_seen_block: { type: "integer", nullable: true },
          last_seen_block: { type: "integer", nullable: true },
          first_seen_ts: { type: "integer", nullable: true, description: "Unix timestamp (seconds)" },
          last_seen_ts: { type: "integer", nullable: true },
          trust_score: { type: "number", example: 72.5 },
          qualified: { type: "integer", enum: [0, 1] },
        },
      },
      SellerRow: {
        type: "object",
        properties: {
          address: { type: "string" },
          unique_buyers: { type: "integer" },
          total_sessions: { type: "integer" },
          total_earned_usdc: { type: "number" },
          ghost_sessions: { type: "integer" },
          first_seen_ts: { type: "integer", nullable: true },
          last_seen_ts: { type: "integer", nullable: true },
          first_seen_block: { type: "integer", nullable: true },
          last_seen_block: { type: "integer", nullable: true },
        },
      },
      ChannelRow: {
        type: "object",
        properties: {
          channel_id: { type: "string", description: "bytes32 hex" },
          buyer_address: { type: "string", nullable: true },
          seller_address: { type: "string", nullable: true },
          state: { type: "string", enum: ["Open", "Settled", "Created"] },
          opened_block: { type: "integer", nullable: true },
          last_block: { type: "integer", nullable: true },
          opened_ts: { type: "integer", nullable: true },
          last_ts: { type: "integer", nullable: true },
          max_amount_usdc: { type: "number", nullable: true },
          settled_amount_usdc: { type: "number", nullable: true },
          total_delta_usdc: { type: "number", nullable: true },
          event_count: { type: "integer" },
        },
      },
      ScoreResponse: {
        type: "object",
        properties: {
          address: { type: "string" },
          score: { type: "number", description: "0–100" },
          tier: { type: "string", enum: ["trusted", "developing", "new", "unknown"] },
          qualified: { type: "boolean" },
          breakdown: {
            type: "object",
            nullable: true,
            properties: {
              total: { type: "number" },
              qualified: { type: "boolean" },
              volume: { type: "number" },
              consistency: { type: "number" },
              diversity: { type: "number" },
              reliability: { type: "number" },
            },
          },
          stats: {
            type: "object",
            nullable: true,
            properties: {
              totalSessions: { type: "integer" },
              totalSettledUsdc: { type: "number" },
              uniqueSellers: { type: "integer" },
              ghostSessions: { type: "integer" },
              firstSeenBlock: { type: "integer", nullable: true },
              lastSeenBlock: { type: "integer", nullable: true },
            },
          },
        },
      },
      Error429: {
        type: "object",
        properties: { error: { type: "string", example: "rate_limit_exceeded" } },
      },
    },
  },
  security: [{}],
  paths: {
    "/api/buyers": {
      get: {
        summary: "List buyers",
        description: "Returns paginated buyer profiles sorted by trust metrics.",
        operationId: "listBuyers",
        security: [{ ApiKey: [] }, {}],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 100, maximum: 1000 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["volume", "sessions", "score", "first_seen", "unique_sellers", "ghosts"], default: "volume" } },
          { name: "qualified", in: "query", schema: { type: "integer", enum: [0, 1] }, description: "Set to 1 to return only qualified buyers" },
          { name: "minScore", in: "query", schema: { type: "number", default: 0 } },
          { name: "format", in: "query", schema: { type: "string", enum: ["csv", "json"] }, description: "csv returns a downloadable CSV; json returns a JSON attachment" },
        ],
        responses: {
          "200": {
            description: "Buyer list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    buyers: { type: "array", items: { "$ref": "#/components/schemas/BuyerRow" } },
                    total: { type: "integer" },
                    limit: { type: "integer" },
                    offset: { type: "integer" },
                  },
                },
              },
            },
          },
          "429": { description: "Rate limit exceeded", content: { "application/json": { schema: { "$ref": "#/components/schemas/Error429" } } } },
        },
      },
    },
    "/api/sellers": {
      get: {
        summary: "List sellers",
        description: "Returns paginated seller profiles sorted by earned USDC or other metrics.",
        operationId: "listSellers",
        security: [{ ApiKey: [] }, {}],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 100, maximum: 1000 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["volume", "sessions", "buyers", "ghosts", "first_seen"], default: "volume" } },
          { name: "dir", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
          { name: "format", in: "query", schema: { type: "string", enum: ["csv", "json"] } },
        ],
        responses: {
          "200": {
            description: "Seller list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sellers: { type: "array", items: { "$ref": "#/components/schemas/SellerRow" } },
                    total: { type: "integer" },
                    limit: { type: "integer" },
                    offset: { type: "integer" },
                  },
                },
              },
            },
          },
          "429": { description: "Rate limit exceeded", content: { "application/json": { schema: { "$ref": "#/components/schemas/Error429" } } } },
        },
      },
    },
    "/api/channels": {
      get: {
        summary: "List channels",
        description: "Returns paginated payment channel records.",
        operationId: "listChannels",
        security: [{ ApiKey: [] }, {}],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 100, maximum: 1000 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["amount", "settled", "events", "opened", "last_activity"], default: "opened" } },
          { name: "dir", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
          { name: "format", in: "query", schema: { type: "string", enum: ["csv", "json"] } },
        ],
        responses: {
          "200": {
            description: "Channel list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    channels: { type: "array", items: { "$ref": "#/components/schemas/ChannelRow" } },
                    total: { type: "integer" },
                    limit: { type: "integer" },
                    offset: { type: "integer" },
                  },
                },
              },
            },
          },
          "429": { description: "Rate limit exceeded", content: { "application/json": { schema: { "$ref": "#/components/schemas/Error429" } } } },
        },
      },
    },
    "/api/score/{address}": {
      get: {
        summary: "Get trust score",
        description: "Returns the trust score and breakdown for a buyer address. Scores range 0–100; buyers with ≥3 unique sellers are qualified.",
        operationId: "getScore",
        security: [{ ApiKey: [] }, {}],
        parameters: [
          { name: "address", in: "path", required: true, schema: { type: "string" }, description: "Ethereum address (0x-prefixed, 40 hex chars)" },
        ],
        responses: {
          "200": { description: "Score and breakdown", content: { "application/json": { schema: { "$ref": "#/components/schemas/ScoreResponse" } } } },
          "404": { description: "Address not indexed", content: { "application/json": { schema: { "$ref": "#/components/schemas/ScoreResponse" } } } },
          "429": { description: "Rate limit exceeded", content: { "application/json": { schema: { "$ref": "#/components/schemas/Error429" } } } },
        },
      },
    },
    "/api/stats": {
      get: {
        summary: "Network statistics",
        description: "Returns aggregate network stats: total buyers, volume, sessions, and daily timeseries.",
        operationId: "getStats",
        responses: {
          "200": {
            description: "Network stats",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    totalBuyers: { type: "integer" },
                    qualifiedBuyers: { type: "integer" },
                    totalVolumeUsdc: { type: "number" },
                    totalSessions: { type: "integer" },
                    totalGhosts: { type: "integer" },
                    lastIndexedBlock: { type: "integer", nullable: true },
                    lastHeadBlock: { type: "integer", nullable: true },
                    lastSyncTs: { type: "integer", nullable: true, description: "Unix ms" },
                    daily: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          day: { type: "string", example: "2025-01-15" },
                          sessions: { type: "integer" },
                          volume: { type: "number" },
                          active_buyers: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/gas": {
      get: {
        summary: "Base gas price",
        description: "Returns the current Base network gas price in Gwei.",
        operationId: "getGas",
        responses: {
          "200": {
            description: "Gas price",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { gwei: { type: "number", example: 0.0042 } },
                },
              },
            },
          },
        },
      },
    },
    "/api/abi": {
      get: {
        summary: "AntSeed Channels ABI",
        description: "Returns the ABI JSON for the AntSeed Channels contract.",
        operationId: "getAbi",
        responses: {
          "200": {
            description: "ABI array",
            content: { "application/json": { schema: { type: "array" } } },
          },
        },
      },
    },
    "/api/sync": {
      post: {
        summary: "Trigger index sync",
        description: "Triggers a manual indexer sync (honours 60s debounce). Same-origin requests only.",
        operationId: "triggerSync",
        responses: {
          "200": {
            description: "Sync result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    fromBlock: { type: "string" },
                    toBlock: { type: "string" },
                    eventsAdded: { type: "integer" },
                    buyersTouched: { type: "integer" },
                    skipped: { type: "string", nullable: true },
                    error: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          "403": { description: "Cross-origin request rejected" },
        },
      },
    },
  },
};

export async function GET() {
  return NextResponse.json(spec, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, s-maxage=3600",
    },
  });
}
