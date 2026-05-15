import type { ExplorerClient, SellerRow } from "../explorer.js";
import { listProvidersSchema } from "../schemas.js";

export const listProvidersTool = {
  name: "list_providers",
  description:
    "Paginated directory of AntFeed sellers (service providers). Backed by /api/sellers on the AntFeed Explorer. Sellers are identified by their on-chain Ethereum address; this is the canonical peerId on the AntSeed network.",
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
          "score = ranked by total USDC earned (the explorer's seller-volume metric). recent = newest sellers (first_seen desc).",
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
  const explorerSort = input.sort === "score" ? "volume" : "first_seen";
  const page = await deps.explorer.listSellers({
    offset: input.offset,
    limit: input.limit,
    sort: explorerSort,
    dir: "desc",
  });
  return {
    providers: page.sellers.map(toProvider),
    total: page.total,
    offset: page.offset,
    limit: page.limit,
    sort: input.sort,
  };
}

export function toProvider(s: SellerRow) {
  return {
    peerId: s.address,
    displayName: shortAddress(s.address),
    score: s.total_earned_usdc,
    servicesOffered: [] as string[],
    lastSeen: s.last_seen_ts ? new Date(s.last_seen_ts * 1000).toISOString() : null,
    totalSessions: s.total_sessions,
    uniqueBuyers: s.unique_buyers,
    ghostSessions: s.ghost_sessions,
    totalEarnedUsdc: s.total_earned_usdc,
    firstSeen: s.first_seen_ts ? new Date(s.first_seen_ts * 1000).toISOString() : null,
  };
}

function shortAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `Seller ${addr.slice(0, 8)}…${addr.slice(-4)}`;
}
