import { decodeCursor, encodeCursor, InvalidCursorError } from "../cursor.js";
import type { ExplorerClient } from "../explorer.js";
import { lookupSchema, PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from "../schemas.js";
import { toProvider } from "./list-providers.js";
import type { ToolDef } from "./registry.js";

export const lookupTool: ToolDef = {
  name: "lookup",
  description:
    "Substring-search the AntFeed provider directory by address, displayName, or service name (case-insensitive). Use for fuzzy discovery; use list_providers to browse, get_pricing for a single price. Returns matched providers with the same shape as list_providers, plus an opaque nextCursor for more matches.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        minLength: 1,
        maxLength: 256,
        description: "Substring matched (case-insensitive) against address, displayName, or any service name",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: PAGINATION_MAX_LIMIT,
        default: PAGINATION_DEFAULT_LIMIT,
        description: `Max matches per page (default ${PAGINATION_DEFAULT_LIMIT}, max ${PAGINATION_MAX_LIMIT}).`,
      },
      cursor: {
        type: "string",
        description: "Opaque pagination token returned by a previous call. Omit for the first page.",
        maxLength: 256,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      matches: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
      matched: { type: "integer", description: "Matches returned on this page" },
      totalMatched: { type: "integer", description: "Total matches across all pages of the searched window" },
      searchedOver: { type: "integer", description: "Providers scanned (top-by-volume window)" },
      explorerTotal: { type: "integer", description: "Total providers in the directory" },
      truncated: { type: "boolean", description: "True when explorerTotal exceeds the scanned window" },
      nextCursor: { type: "string", description: "Pass back as `cursor` to fetch the next page of matches." },
      note: { type: "string" },
    },
    required: ["query", "matches", "matched", "totalMatched", "searchedOver", "explorerTotal", "truncated"],
    additionalProperties: false,
  },
  annotations: {
    title: "Search Providers",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const LOOKUP_PAGE_SIZE = 1000;

export async function lookup(raw: unknown, deps: { explorer: ExplorerClient }) {
  const input = lookupSchema.parse(raw);
  const offset = decodeOrThrow(input.cursor);

  const page = await deps.explorer.listProvidersDirectory({ limit: LOOKUP_PAGE_SIZE, sort: "volume" });
  const q = input.query.toLowerCase();

  const allMatches = page.providers.filter((p) => {
    if (p.address.toLowerCase().includes(q)) return true;
    if (p.displayName && p.displayName.toLowerCase().includes(q)) return true;
    for (const svc of p.services) {
      if (svc.toLowerCase().includes(q)) return true;
    }
    return false;
  });

  const pageMatches = allMatches.slice(offset, offset + input.limit).map(toProvider);
  const nextOffset = offset + pageMatches.length;
  const hasMore = nextOffset < allMatches.length && pageMatches.length > 0;
  const explorerTotal = page.total;
  const searchedOver = page.providers.length;
  const truncated = explorerTotal > searchedOver;

  return {
    query: input.query,
    matches: pageMatches,
    matched: pageMatches.length,
    totalMatched: allMatches.length,
    searchedOver,
    explorerTotal,
    truncated,
    ...(hasMore ? { nextCursor: encodeCursor(nextOffset) } : {}),
    ...(buildNote(allMatches.length, truncated) ? { note: buildNote(allMatches.length, truncated)! } : {}),
  };
}

function decodeOrThrow(cursor: string | undefined): number {
  try {
    return decodeCursor(cursor);
  } catch (err) {
    if (err instanceof InvalidCursorError) throw err;
    throw err;
  }
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
