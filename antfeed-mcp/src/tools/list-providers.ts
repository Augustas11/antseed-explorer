import type { ExplorerClient } from "../explorer.js";
import type { DirectoryProviderRow } from "../schemas.js";
import { listProvidersSchema } from "../schemas.js";

export const listProvidersTool = {
  name: "list_providers",
  description:
    "Paginated directory of AntFeed providers (AntSeed sellers). Returns display name, region, advertised services, per-service pricing ($/M tokens, input + output), session count, total USDC earned, ghost rate, and last-refresh timestamp. Sourced from /api/providers on the AntFeed Explorer, refreshed hourly from network.antseed.com.",
  inputSchema: {
    type: "object" as const,
    properties: {
      offset: { type: "integer", minimum: 0, default: 0 },
      limit: { type: "integer", minimum: 1, maximum: 1000, default: 20 },
      sort: {
        type: "string",
        enum: ["score", "recent"],
        default: "score",
        description:
          "score = total USDC earned (volume). recent = newest in directory (by last-refresh timestamp).",
      },
    },
    additionalProperties: false,
  },
};

export async function listProviders(
  raw: unknown,
  deps: { explorer: ExplorerClient },
): Promise<{
  providers: ReturnType<typeof toProvider>[];
  total: number;
  offset: number;
  limit: number;
  sort: "score" | "recent";
}> {
  const input = listProvidersSchema.parse(raw);
  const page = await deps.explorer.listProvidersDirectory({
    offset: input.offset,
    limit: input.limit,
    sort: input.sort === "score" ? "volume" : "volume",
  });
  // We don't ask the API for "recent" sort because the API surfaces "volume",
  // "sessions", "ghost". For "recent" we sort client-side by updatedAt desc.
  let providers = page.providers;
  if (input.sort === "recent") {
    providers = [...providers].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }
  return {
    providers: providers.map(toProvider),
    total: page.total,
    offset: page.offset,
    limit: page.limit,
    sort: input.sort,
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
    pricing: p.pricing,
    pricingSummary: summarizePricing(p.pricing, p.services),
    sessionCount: p.sessionCount,
    totalVolumeUsdc: p.totalVolumeUsdc,
    ghostCount: p.ghostCount,
    closedCount: p.closedCount,
    ghostRate,
    score: p.totalVolumeUsdc,
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
