import type { ExplorerClient } from "../explorer.js";
import { getPricingSchema } from "../schemas.js";
import type { ToolDef } from "./registry.js";

export const getPricingTool: ToolDef = {
  name: "get_pricing",
  description:
    "Look up a single seller's advertised price for one service. Use for point lookups (peerId + service); use list_providers to browse. Returns input/output USDC per million tokens with status INDEXED | PROVIDER_NOT_INDEXED | SERVICE_NOT_OFFERED | PRICE_NOT_PUBLISHED. Refreshed hourly from network.antseed.com.",
  inputSchema: {
    type: "object",
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
  outputSchema: {
    type: "object",
    properties: {
      peerId: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
      service: { type: "string" },
      status: {
        type: "string",
        enum: ["INDEXED", "PROVIDER_NOT_INDEXED", "SERVICE_NOT_OFFERED", "PRICE_NOT_PUBLISHED"],
      },
      currency: { type: "string", enum: ["USDC"] },
      inputUsdPerMillion: { type: ["number", "null"] },
      outputUsdPerMillion: { type: ["number", "null"] },
      displayName: { type: ["string", "null"] },
      region: { type: ["string", "null"] },
      lastUpdated: { type: ["string", "null"], description: "ISO timestamp of directory refresh" },
      availableServices: {
        type: "array",
        items: { type: "string" },
        description: "Returned only on SERVICE_NOT_OFFERED",
      },
      message: { type: "string", description: "Human-readable explanation of the status" },
    },
    required: ["peerId", "service", "status", "currency", "inputUsdPerMillion", "outputUsdPerMillion"],
    additionalProperties: false,
  },
  annotations: {
    title: "Get Pricing",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
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
      currency: "USDC" as const,
      message:
        "This address is not in the AntFeed provider directory. The directory is refreshed hourly from network.antseed.com — if the seller is brand new, check again shortly.",
      inputUsdPerMillion: null,
      outputUsdPerMillion: null,
      displayName: null,
      region: null,
      lastUpdated: null,
    };
  }

  if (!seller.services.includes(input.service)) {
    return {
      peerId: input.peerId,
      service: input.service,
      status: "SERVICE_NOT_OFFERED" as const,
      currency: "USDC" as const,
      message: `Seller does not advertise '${input.service}'. Services on offer: ${seller.services.length ? seller.services.join(", ") : "(none indexed)"}.`,
      availableServices: seller.services,
      displayName: seller.displayName,
      region: seller.region,
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
      currency: "USDC" as const,
      message:
        "Seller advertises this service but has not published a price for it. Open a session via create_session for a live negotiated quote.",
      displayName: seller.displayName,
      region: seller.region,
      inputUsdPerMillion: null,
      outputUsdPerMillion: null,
      lastUpdated: seller.updatedAt ? new Date(seller.updatedAt).toISOString() : null,
    };
  }

  return {
    peerId: input.peerId,
    service: input.service,
    status: "INDEXED" as const,
    currency: "USDC" as const,
    inputUsdPerMillion: p.inputUsdPerMillion ?? null,
    outputUsdPerMillion: p.outputUsdPerMillion ?? null,
    displayName: seller.displayName,
    region: seller.region,
    lastUpdated: seller.updatedAt ? new Date(seller.updatedAt).toISOString() : null,
  };
}
