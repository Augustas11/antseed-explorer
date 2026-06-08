import { NextResponse } from "next/server";
import {
  BUYER_DEFAULT_SORT,
  BUYER_SORTS,
  CHANNEL_DEFAULT_SORT,
  CHANNEL_SORTS,
  DEFAULT_SORT_DIRECTION,
  EXPORT_FORMATS,
  PROVIDER_DEFAULT_SORT,
  PROVIDER_SORTS,
  PUBLIC_RESPONSE_FIELDS,
  SELLER_DEFAULT_SORT,
  SELLER_SORTS,
  SORT_DIRECTIONS,
} from "@/lib/publicApiContract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const spec = {
  openapi: "3.0.3",
  info: {
    title: "AntSeed Explorer API",
    version: "1.0.0",
    description:
      "REST API for the AntSeed Channels protocol on Base. Indexes buyer/seller payment channel events and computes trust scores.\n\n**Rate limits:** shared fixed-window limits of 60 req/min unauthenticated · 300 req/min with `X-Api-Key` header when the database is available. Exceeded limits return `429` with a `Retry-After` header. API key creation is operator-gated.",
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
        required: PUBLIC_RESPONSE_FIELDS.BuyerRow,
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
        required: PUBLIC_RESPONSE_FIELDS.SellerRow,
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
        required: PUBLIC_RESPONSE_FIELDS.ChannelRow,
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
      ServicePricing: {
        type: "object",
        description: "Per-service pricing as USDC per million tokens.",
        required: PUBLIC_RESPONSE_FIELDS.ServicePricing,
        properties: {
          inputUsdPerMillion: { type: "number", nullable: true, example: 0.21 },
          outputUsdPerMillion: { type: "number", nullable: true, example: 5.00 },
        },
      },
      DirectoryProviderRow: {
        type: "object",
        description: "Service provider as indexed in the AntFeed provider directory (refreshed hourly from network.antseed.com), joined with on-chain channel aggregates.",
        required: PUBLIC_RESPONSE_FIELDS.DirectoryProviderRow,
        properties: {
          address: { type: "string", example: "0x4668854ba3e8b094e6f48fbeb59cec1cfde162f2" },
          displayName: { type: "string", nullable: true, example: "Dark Signal" },
          region: { type: "string", nullable: true, example: "us-east" },
          services: { type: "array", items: { type: "string" }, example: ["gpt-5.4", "gpt-5.5"] },
          pricing: {
            type: "object",
            description: "Map of service name to { inputUsdPerMillion, outputUsdPerMillion }.",
            additionalProperties: { "$ref": "#/components/schemas/ServicePricing" },
          },
          sessionCount: { type: "integer", example: 3645 },
          totalVolumeUsdc: { type: "number", example: 2821.08 },
          ghostCount: { type: "integer", example: 0 },
          closedCount: { type: "integer", example: 100 },
          updatedAt: {
            type: "integer",
            nullable: true,
            description: "Unix milliseconds — last directory refresh for this provider.",
          },
          operatorAddress: {
            type: "string",
            nullable: true,
            description: "When non-null, `address` is a seller delegation contract that settles on AntseedChannels and `operatorAddress` is the peerId-derived operator EVM address. When null, `address` IS the operator.",
            example: "0x9e8f9aaee684298b7f2af2ae008e3692f0e9f4f7",
          },
        },
      },
      SellerServicesResponse: {
        type: "object",
        required: PUBLIC_RESPONSE_FIELDS.SellerServicesResponse,
        properties: {
          address: { type: "string" },
          displayName: { type: "string", nullable: true },
          region: { type: "string", nullable: true },
          services: { type: "array", items: { type: "string" } },
          pricing: {
            type: "object",
            additionalProperties: { "$ref": "#/components/schemas/ServicePricing" },
          },
          updatedAt: { type: "integer", nullable: true },
        },
      },
      BuyerSessionEvent: {
        type: "object",
        required: PUBLIC_RESPONSE_FIELDS.BuyerSessionEvent,
        properties: {
          tx_hash: { type: "string", nullable: true },
          block_number: { type: "integer", nullable: true },
          event_type: { type: "string" },
          seller_address: { type: "string", nullable: true },
          channel_id: { type: "string", nullable: true },
          delta_usdc: { type: "number", nullable: true },
          settled_amount_usdc: { type: "number", nullable: true },
          timestamp: { type: "integer", nullable: true },
          seller_label: { type: "string", nullable: true },
        },
      },
      BuyerSellerSummaryRow: {
        type: "object",
        required: PUBLIC_RESPONSE_FIELDS.BuyerSellerSummaryRow,
        properties: {
          seller_address: { type: "string" },
          sessions: { type: "integer" },
          total_usdc: { type: "number" },
          seller_label: { type: "string", nullable: true },
        },
      },
      BuyerMonthlyVolumeRow: {
        type: "object",
        required: PUBLIC_RESPONSE_FIELDS.BuyerMonthlyVolumeRow,
        properties: {
          month: { type: "string", example: "2026-06" },
          sessions: { type: "integer" },
          volume: { type: "number" },
        },
      },
      BuyerProfileResponse: {
        type: "object",
        required: PUBLIC_RESPONSE_FIELDS.BuyerProfileResponse,
        properties: {
          profile: { "$ref": "#/components/schemas/BuyerRow" },
          sessions: { type: "array", items: { "$ref": "#/components/schemas/BuyerSessionEvent" } },
          topSellers: { type: "array", items: { "$ref": "#/components/schemas/BuyerSellerSummaryRow" } },
          monthly: { type: "array", items: { "$ref": "#/components/schemas/BuyerMonthlyVolumeRow" } },
        },
      },
      ScoreResponse: {
        type: "object",
        required: PUBLIC_RESPONSE_FIELDS.ScoreResponse,
        properties: {
          address: { type: "string" },
          score: { type: "number", description: "0–100" },
          tier: { type: "string", enum: ["trusted", "developing", "new", "unknown"] },
          qualified: { type: "boolean" },
          breakdown: {
            type: "object",
            nullable: true,
            required: PUBLIC_RESPONSE_FIELDS.TrustScoreBreakdown,
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
            required: PUBLIC_RESPONSE_FIELDS.ScoreStats,
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
      ProfileDrift: {
        type: "object",
        required: PUBLIC_RESPONSE_FIELDS.ProfileDrift,
        properties: {
          eventsUsdc: { type: "number" },
          profilesUsdc: { type: "number" },
          driftUsdc: { type: "number" },
        },
      },
      StatsResponse: {
        type: "object",
        required: PUBLIC_RESPONSE_FIELDS.StatsResponse,
        properties: {
          totalBuyers: { type: "integer" },
          qualifiedBuyers: { type: "integer" },
          totalVolumeUsdc: { type: "number" },
          totalSessions: { type: "integer" },
          totalGhosts: { type: "integer" },
          lastIndexedBlock: { type: "integer", nullable: true },
          lastHeadBlock: { type: "integer", nullable: true },
          lastSyncTs: { type: "integer", nullable: true, description: "Unix ms" },
          drift: { "$ref": "#/components/schemas/ProfileDrift" },
          daily: {
            type: "array",
            items: {
              type: "object",
              required: PUBLIC_RESPONSE_FIELDS.StatsDailyRow,
              properties: {
                day: { type: "string", example: "2025-01-15" },
                sessions: { type: "integer" },
                volume: { type: "number" },
                active_buyers: { type: "integer" },
                daily_active_users: { type: "integer", description: "Total unique wallets with any on-chain activity that day" },
                new_users: { type: "integer", description: "Wallets appearing for the first time that day" },
              },
            },
          },
        },
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
          { name: "sort", in: "query", schema: { type: "string", enum: BUYER_SORTS, default: BUYER_DEFAULT_SORT } },
          { name: "qualified", in: "query", schema: { type: "integer", enum: [0, 1] }, description: "Set to 1 to return only qualified buyers" },
          { name: "minScore", in: "query", schema: { type: "number", default: 0 } },
          { name: "format", in: "query", schema: { type: "string", enum: EXPORT_FORMATS }, description: "csv returns a downloadable CSV; json returns a JSON attachment" },
        ],
        responses: {
          "200": {
            description: "Buyer list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: PUBLIC_RESPONSE_FIELDS.BuyersPage,
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
    "/api/buyers/{address}": {
      get: {
        summary: "Get buyer profile",
        description: "Returns one buyer profile with recent sessions, top sellers, and monthly settled volume.",
        operationId: "getBuyerProfile",
        security: [{ ApiKey: [] }, {}],
        parameters: [
          { name: "address", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, description: "Ethereum address (0x-prefixed, 40 hex chars)" },
        ],
        responses: {
          "200": { description: "Buyer profile", content: { "application/json": { schema: { "$ref": "#/components/schemas/BuyerProfileResponse" } } } },
          "400": { description: "Invalid address" },
          "404": { description: "Buyer not found" },
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
          { name: "sort", in: "query", schema: { type: "string", enum: SELLER_SORTS, default: SELLER_DEFAULT_SORT } },
          { name: "dir", in: "query", schema: { type: "string", enum: SORT_DIRECTIONS, default: DEFAULT_SORT_DIRECTION } },
          { name: "format", in: "query", schema: { type: "string", enum: EXPORT_FORMATS } },
        ],
        responses: {
          "200": {
            description: "Seller list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: PUBLIC_RESPONSE_FIELDS.SellersPage,
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
    "/api/providers": {
      get: {
        summary: "List providers (directory)",
        description: "Returns the AntFeed provider directory (display names, services, per-service pricing, region, trust score, on-chain aggregates). Refreshed hourly from network.antseed.com.",
        operationId: "listProviders",
        security: [{ ApiKey: [] }, {}],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 100, maximum: 1000 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
          { name: "sort", in: "query", schema: { type: "string", enum: PROVIDER_SORTS, default: PROVIDER_DEFAULT_SORT } },
        ],
        responses: {
          "200": {
            description: "Provider directory page",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: PUBLIC_RESPONSE_FIELDS.ProvidersPage,
                  properties: {
                    providers: { type: "array", items: { "$ref": "#/components/schemas/DirectoryProviderRow" } },
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
    "/api/sellers/{address}/services": {
      get: {
        summary: "Get a seller's service catalog + pricing",
        description: "Returns the services advertised by one seller, with per-service pricing as USDC per million tokens. Source: AntFeed provider directory, refreshed hourly.",
        operationId: "getSellerServices",
        security: [{ ApiKey: [] }, {}],
        parameters: [
          { name: "address", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, description: "Seller's on-chain Ethereum address" },
        ],
        responses: {
          "200": { description: "Seller services + pricing", content: { "application/json": { schema: { "$ref": "#/components/schemas/SellerServicesResponse" } } } },
          "400": { description: "Invalid address format" },
          "404": { description: "Seller not in the indexed directory" },
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
          { name: "sort", in: "query", schema: { type: "string", enum: CHANNEL_SORTS, default: CHANNEL_DEFAULT_SORT } },
          { name: "dir", in: "query", schema: { type: "string", enum: SORT_DIRECTIONS, default: DEFAULT_SORT_DIRECTION } },
          { name: "format", in: "query", schema: { type: "string", enum: EXPORT_FORMATS } },
        ],
        responses: {
          "200": {
            description: "Channel list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: PUBLIC_RESPONSE_FIELDS.ChannelsPage,
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
    "/api/channels/{id}": {
      get: {
        summary: "Get one channel",
        description: "Returns one payment channel by bytes32 channel id.",
        operationId: "getChannel",
        security: [{ ApiKey: [] }, {}],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" }, description: "Channel id (bytes32 hex)" },
        ],
        responses: {
          "200": { description: "Channel", content: { "application/json": { schema: { "$ref": "#/components/schemas/ChannelRow" } } } },
          "400": { description: "Invalid channel id" },
          "404": { description: "Channel not found" },
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
    "/api/search": {
      get: {
        summary: "Search indexed entities",
        description: "Returns up to 8 matches across buyers, sellers, channels, transactions, services, and provider display names.",
        operationId: "searchEntities",
        security: [{ ApiKey: [] }, {}],
        parameters: [
          { name: "q", in: "query", schema: { type: "string", maxLength: 120 }, description: "Search query." },
        ],
        responses: {
          "200": {
            description: "Search matches",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["matches"],
                  properties: {
                    matches: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["type", "label", "detail", "href", "exact"],
                        properties: {
                          type: { type: "string", enum: ["buyer", "seller", "channel", "tx", "service"] },
                          label: { type: "string" },
                          detail: { type: "string" },
                          href: { type: "string" },
                          exact: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
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
            content: { "application/json": { schema: { "$ref": "#/components/schemas/StatsResponse" } } },
          },
        },
      },
    },
    "/api/metrics/dau": {
      get: {
        summary: "Daily active users",
        description: "Returns daily active user rows from the daily_dau pre-aggregate.",
        operationId: "getDau",
        security: [{ ApiKey: [] }, {}],
        parameters: [
          { name: "from", in: "query", schema: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, description: "Inclusive UTC day. Defaults to 29 days before today." },
          { name: "to", in: "query", schema: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, description: "Inclusive UTC day. Defaults to today." },
          { name: "granularity", in: "query", schema: { type: "string", enum: ["day"], default: "day" } },
        ],
        responses: {
          "200": {
            description: "Daily active user rows",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    required: PUBLIC_RESPONSE_FIELDS.DauDayRow,
                    properties: {
                      day: { type: "string", example: "2026-06-03" },
                      new: { type: "integer" },
                      existing: { type: "integer" },
                      total: { type: "integer" },
                      dau_buyers: { type: "integer" },
                      dau_sellers: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid range or unsupported granularity" },
          "429": { description: "Rate limit exceeded", content: { "application/json": { schema: { "$ref": "#/components/schemas/Error429" } } } },
        },
      },
    },
    "/api/read-contract": {
      post: {
        summary: "Read allowlisted AntSeed contract functions",
        description: "Reads allowlisted view functions on the AntseedChannels contract. Supported functions: getChannel(bytes32), balanceOf(address).",
        operationId: "readContract",
        security: [{ ApiKey: [] }, {}],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["fnName", "args"],
                properties: {
                  fnName: { type: "string", enum: ["getChannel", "balanceOf"] },
                  args: { type: "array", items: {} },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Serialized contract result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: PUBLIC_RESPONSE_FIELDS.ReadContractResponse,
                  properties: {
                    ok: { type: "boolean" },
                    result: {},
                  },
                },
              },
            },
          },
          "400": { description: "Invalid request, function, or arguments" },
          "429": { description: "Rate limit exceeded", content: { "application/json": { schema: { "$ref": "#/components/schemas/Error429" } } } },
          "502": { description: "RPC read failed" },
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
                  required: PUBLIC_RESPONSE_FIELDS.GasResponse,
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
        description: "Triggers a manual indexer sync (honours 60s debounce). Requires `Authorization: Bearer <SYNC_SECRET|CRON_SECRET>`.",
        operationId: "triggerSync",
        responses: {
          "200": {
            description: "Sync result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: PUBLIC_RESPONSE_FIELDS.SyncResponse,
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
          "401": { description: "Missing or invalid sync secret" },
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
