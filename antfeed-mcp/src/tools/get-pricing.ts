import type { ExplorerClient } from "../explorer.js";
import { getPricingSchema } from "../schemas.js";

export const getPricingTool = {
  name: "get_pricing",
  description:
    "Returns live pricing for a given (peerId, service) pair from the AntFeed provider directory. Prices are USDC per million tokens. Source: /api/sellers/{address}/services on the AntFeed Explorer, refreshed hourly from network.antseed.com. Feedback or issues: https://antfeed.org/mcp#feedback",
  inputSchema: {
    type: "object" as const,
    properties: {
      peerId: {
        type: "string",
        description: "Seller's on-chain address (0x + 40 hex chars)",
        pattern: "^0x[0-9a-fA-F]{40}$",
      },
      service: {
        type: "string",
        description: "Service identifier (e.g. 'gpt-5.4', 'code-auditor')",
        minLength: 1,
        maxLength: 64,
      },
    },
    required: ["peerId", "service"],
    additionalProperties: false,
  },
};

export async function getPricing(raw: unknown, deps: { explorer: ExplorerClient }) {
  const input = getPricingSchema.parse(raw);

  const seller = await deps.explorer.getSellerServices(input.peerId);

  if (!seller) {
    return {
      peerId: input.peerId,
      service: input.service,
      status: "PROVIDER_NOT_INDEXED" as const,
      currency: "USDC",
      message:
        "This address is not in the AntFeed provider directory. The directory is refreshed hourly from network.antseed.com — if the seller is brand new, check again shortly.",
      inputUsdPerMillion: null,
      outputUsdPerMillion: null,
      lastUpdated: null,
    };
  }

  if (!seller.services.includes(input.service)) {
    return {
      peerId: input.peerId,
      service: input.service,
      status: "SERVICE_NOT_OFFERED" as const,
      currency: "USDC",
      message: `Seller does not advertise '${input.service}'. Services on offer: ${seller.services.length ? seller.services.join(", ") : "(none indexed)"}.`,
      availableServices: seller.services,
      displayName: seller.displayName,
      inputUsdPerMillion: null,
      outputUsdPerMillion: null,
      lastUpdated: seller.updatedAt ? new Date(seller.updatedAt).toISOString() : null,
    };
  }

  const p = seller.pricing[input.service];

  if (!p || (p.inputUsdPerMillion == null && p.outputUsdPerMillion == null)) {
    return {
      peerId: input.peerId,
      service: input.service,
      status: "PRICE_NOT_PUBLISHED" as const,
      currency: "USDC",
      message:
        "Seller advertises this service but has not published a price for it. Open a session via create_session for a live negotiated quote.",
      displayName: seller.displayName,
      inputUsdPerMillion: null,
      outputUsdPerMillion: null,
      lastUpdated: seller.updatedAt ? new Date(seller.updatedAt).toISOString() : null,
    };
  }

  return {
    peerId: input.peerId,
    service: input.service,
    status: "INDEXED" as const,
    currency: "USDC",
    inputUsdPerMillion: p.inputUsdPerMillion ?? null,
    outputUsdPerMillion: p.outputUsdPerMillion ?? null,
    displayName: seller.displayName,
    region: seller.region,
    lastUpdated: seller.updatedAt ? new Date(seller.updatedAt).toISOString() : null,
    note: "Prices are advertised rates from the AntSeed network's provider directory. The actual rate is finalized at session-open time when the buyer negotiates with the seller.",
  };
}
