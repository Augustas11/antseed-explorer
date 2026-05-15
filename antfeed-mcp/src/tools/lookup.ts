import type { ExplorerClient } from "../explorer.js";
import { lookupSchema } from "../schemas.js";
import { toProvider } from "./list-providers.js";

export const lookupTool = {
  name: "lookup",
  description:
    "Fuzzy search across AntFeed providers (sellers). v1 performs case-insensitive substring matching against seller Ethereum addresses, paged over /api/sellers. A server-side /api/search endpoint is planned for v1.1 — see README.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", minLength: 1, description: "Substring to match against seller addresses" },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const LOOKUP_PAGE_SIZE = 1000;

export async function lookup(raw: unknown, deps: { explorer: ExplorerClient }) {
  const input = lookupSchema.parse(raw);
  const page = await deps.explorer.listSellers({ limit: LOOKUP_PAGE_SIZE, sort: "volume", dir: "desc" });
  const q = input.query.toLowerCase();
  const matches = page.sellers
    .filter((s) => s.address.toLowerCase().includes(q))
    .slice(0, input.limit)
    .map(toProvider);
  const truncated = page.total > page.sellers.length;
  return {
    query: input.query,
    matches,
    matched: matches.length,
    searchedOver: page.sellers.length,
    explorerTotal: page.total,
    truncated,
    note: buildNote(matches.length, truncated),
  };
}

function buildNote(matched: number, truncated: boolean): string | undefined {
  if (matched === 0 && truncated) {
    return `No sellers matched in the top ${LOOKUP_PAGE_SIZE} by volume. The explorer holds more sellers — a v1.1 server-side /api/search will cover them. Try list_providers with paging if you need to scan deeper.`;
  }
  if (matched === 0) {
    return "No sellers matched. Try a shorter prefix or call list_providers to browse.";
  }
  if (truncated) {
    return `Searched only the top ${LOOKUP_PAGE_SIZE} sellers by volume; deeper results may exist.`;
  }
  return undefined;
}
