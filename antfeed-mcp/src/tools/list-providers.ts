import { decodeCursor, encodeCursor, InvalidCursorError } from "../cursor.js";
import type { ExplorerClient } from "../explorer.js";
import type { DirectoryProviderRow } from "../schemas.js";
import { listProvidersSchema, PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from "../schemas.js";
import type { ToolDef } from "./registry.js";

export const listProvidersTool: ToolDef = {
  name: "list_providers",
  description:
    "Browse the AntFeed provider directory page by page. Use to discover sellers; use lookup for substring search, get_pricing for a single (peerId, service) lookup. sort: score (USDC earned, default) | recent (last refresh). Returns up to limit providers per page, plus an opaque nextCursor for the next page.",
  inputSchema: {
    type: "object",
    properties: {
      cursor: {
        type: "string",
        description: "Opaque pagination token returned by a previous call. Omit for the first page.",
        maxLength: 256,
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: PAGINATION_MAX_LIMIT,
        default: PAGINATION_DEFAULT_LIMIT,
        description: `Max providers per page (default ${PAGINATION_DEFAULT_LIMIT}, max ${PAGINATION_MAX_LIMIT}).`,
      },
      sort: {
        type: "string",
        enum: ["score", "recent"],
        default: "score",
        description: "score = total USDC earned; recent = newest in directory (by last-refresh timestamp).",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      providers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            peerId: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
            displayName: { type: "string" },
            region: { type: ["string", "null"] },
            services: { type: "array", items: { type: "string" } },
            pricingSummary: {
              type: "object",
              properties: {
                minInputUsdPerMillion: { type: ["number", "null"] },
                maxInputUsdPerMillion: { type: ["number", "null"] },
                servicesPriced: { type: "integer" },
              },
              required: ["minInputUsdPerMillion", "maxInputUsdPerMillion", "servicesPriced"],
            },
            sessionCount: { type: "integer" },
            totalVolumeUsdc: { type: "number" },
            ghostRate: { type: ["number", "null"], description: "ghostCount / closedCount, null when closedCount=0" },
            lastUpdated: { type: ["string", "null"], description: "ISO timestamp" },
          },
          required: [
            "peerId",
            "displayName",
            "region",
            "services",
            "pricingSummary",
            "sessionCount",
            "totalVolumeUsdc",
            "ghostRate",
            "lastUpdated",
          ],
        },
      },
      total: { type: "integer", description: "Total providers across all pages" },
      sort: { type: "string", enum: ["score", "recent"] },
      nextCursor: {
        type: "string",
        description: "Pass back as `cursor` to fetch the next page. Absent when no more results.",
      },
    },
    required: ["providers", "total", "sort"],
    additionalProperties: false,
  },
  annotations: {
    title: "List Providers",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export async function listProviders(raw: unknown, deps: { explorer: ExplorerClient }) {
  const input = listProvidersSchema.parse(raw);
  let offset: number;
  try {
    offset = decodeCursor(input.cursor);
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      const e = new Error(err.message) as Error & { name: string };
      e.name = "InvalidCursorError";
      // Surface as INVALID_INPUT via the error mapper in index.ts.
      throw err;
    }
    throw err;
  }

  const page = await deps.explorer.listProvidersDirectory({
    offset,
    limit: input.limit,
    // Upstream supports "volume" | "sessions" | "ghost". For both "score" and "recent"
    // we fetch by volume; "recent" is then re-sorted client-side within the page.
    sort: "volume",
  });

  let providers = page.providers;
  if (input.sort === "recent") {
    providers = [...providers].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  const nextOffset = offset + providers.length;
  const hasMore = nextOffset < page.total && providers.length > 0;

  return {
    providers: providers.map(toProvider),
    total: page.total,
    sort: input.sort,
    ...(hasMore ? { nextCursor: encodeCursor(nextOffset) } : {}),
  };
}

export function toProvider(p: DirectoryProviderRow) {
  const ghostRate =
    p.closedCount > 0 ? Number((p.ghostCount / p.closedCount).toFixed(4)) : null;
  return {
    peerId: p.address,
    displayName: p.displayName ?? shortAddress(p.address),
    region: p.region,
    services: p.services,
    pricingSummary: summarizePricing(p.pricing, p.services),
    sessionCount: p.sessionCount,
    totalVolumeUsdc: p.totalVolumeUsdc,
    ghostRate,
    lastUpdated: p.updatedAt ? new Date(p.updatedAt).toISOString() : null,
  };
}

function summarizePricing(
  pricing: DirectoryProviderRow["pricing"],
  services: string[],
): { minInputUsdPerMillion: number | null; maxInputUsdPerMillion: number | null; servicesPriced: number } {
  const inputs: number[] = [];
  let priced = 0;
  for (const svc of services) {
    const p = pricing[svc];
    if (!p) continue;
    if (typeof p.inputUsdPerMillion === "number") {
      inputs.push(p.inputUsdPerMillion);
      priced++;
    } else if (typeof p.outputUsdPerMillion === "number") {
      priced++;
    }
  }
  return {
    minInputUsdPerMillion: inputs.length ? Math.min(...inputs) : null,
    maxInputUsdPerMillion: inputs.length ? Math.max(...inputs) : null,
    servicesPriced: priced,
  };
}

function shortAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `Seller ${addr.slice(0, 8)}…${addr.slice(-4)}`;
}
