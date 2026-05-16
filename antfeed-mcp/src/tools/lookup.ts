import type { ExplorerClient } from "../explorer.js";
import { lookupSchema } from "../schemas.js";
import { toProvider } from "./list-providers.js";

export const lookupTool = {
  name: "lookup",
  description:
    "Search the AntFeed provider directory. Matches against seller address, display name, and advertised service names (all case-insensitive substring). Returns the same rich shape as list_providers — display name, services, pricing summary, on-chain aggregates. Feedback or issues: https://antfeed.org/mcp#feedback",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", minLength: 1, description: "Substring (matches address, displayName, or any service name)" },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const LOOKUP_PAGE_SIZE = 1000;

export async function lookup(raw: unknown, deps: { explorer: ExplorerClient }) {
  const input = lookupSchema.parse(raw);
  const page = await deps.explorer.listProvidersDirectory({ limit: LOOKUP_PAGE_SIZE, sort: "volume" });
  const q = input.query.toLowerCase();

  const matches = page.providers
    .filter((p) => {
      if (p.address.toLowerCase().includes(q)) return true;
      if (p.displayName && p.displayName.toLowerCase().includes(q)) return true;
      for (const svc of p.services) {
        if (svc.toLowerCase().includes(q)) return true;
      }
      return false;
    })
    .slice(0, input.limit)
    .map(toProvider);

  const truncated = page.total > page.providers.length;
  return {
    query: input.query,
    matches,
    matched: matches.length,
    searchedOver: page.providers.length,
    explorerTotal: page.total,
    truncated,
    note: buildNote(matches.length, truncated),
  };
}

function buildNote(matched: number, truncated: boolean): string | undefined {
  if (matched === 0 && truncated) {
    return `No providers matched in the top ${LOOKUP_PAGE_SIZE} by volume. Deeper search support is planned.`;
  }
  if (matched === 0) {
    return "No providers matched. Try a shorter prefix, a different service name, or list_providers to browse.";
  }
  if (truncated) {
    return `Searched only the top ${LOOKUP_PAGE_SIZE} providers by volume; deeper results may exist.`;
  }
  return undefined;
}
