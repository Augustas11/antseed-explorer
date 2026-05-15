import { getPricingSchema } from "../schemas.js";

export const getPricingTool = {
  name: "get_pricing",
  description:
    "Returns pricing for a (peerId, service) pair. NOTE: AntFeed pricing is not yet indexed by the explorer — this tool currently returns a structured 'NOT_INDEXED' placeholder. Use create_session to negotiate a live quote with the seller via the local buyer. A server-side pricing endpoint is planned; see https://antfeed.org for the current pricing-decision doc.",
  inputSchema: {
    type: "object" as const,
    properties: {
      peerId: { type: "string", description: "Seller's on-chain address (Ethereum 0x... hex)" },
      service: { type: "string", description: "Service identifier (e.g. 'llm-proxy', 'code-auditor')" },
    },
    required: ["peerId", "service"],
    additionalProperties: false,
  },
};

export async function getPricing(raw: unknown) {
  const input = getPricingSchema.parse(raw);
  return {
    peerId: input.peerId,
    service: input.service,
    pricePerToken: null,
    currency: "USDC",
    model: null,
    lastUpdated: null,
    status: "NOT_INDEXED" as const,
    message:
      "Pricing is currently mid-revision and is not yet indexed by the AntFeed Explorer. To obtain a live quote, call create_session — the local AntSeed buyer negotiates pricing with the seller at session-open time and returns the agreed terms.",
    pricingDoc: "https://antfeed.org",
  };
}
