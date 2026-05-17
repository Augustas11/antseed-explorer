import { buyerSetupTool } from "./buyer-setup.js";
import { createSessionTool } from "./create-session.js";
import { dauTrendTool } from "./dau-trend.js";
import { getBuyerTool } from "./get-buyer.js";
import { getPricingTool } from "./get-pricing.js";
import { getSessionStatusTool } from "./get-session-status.js";
import { listProvidersTool } from "./list-providers.js";
import { lookupTool } from "./lookup.js";
import { networkStatsTool } from "./network-stats.js";

export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

// MCP 2025-06-18 `annotations` field — non-binding behavioral hints to clients
// (e.g. so Claude Desktop can show a confirm dialog before destructive calls).
export interface ToolAnnotations {
  /** Human-readable title shown by some clients. */
  title?: string;
  /** Tool does not mutate state. */
  readOnlyHint?: boolean;
  /** Tool can destroy or permanently alter state. */
  destructiveHint?: boolean;
  /** Repeated calls with identical inputs are equivalent to one call. */
  idempotentHint?: boolean;
  /** Tool may interact with an "open" world (external systems beyond this server's control). */
  openWorldHint?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  outputSchema?: JsonSchemaObject;
  annotations?: ToolAnnotations;
}

export const READ_ONLY_TOOLS: readonly ToolDef[] = [
  lookupTool,
  listProvidersTool,
  getPricingTool,
  getSessionStatusTool,
  networkStatsTool,
  getBuyerTool,
  dauTrendTool,
];

export function buildTools(buyerReachable: boolean): ToolDef[] {
  return [...READ_ONLY_TOOLS, buyerReachable ? createSessionTool : buyerSetupTool];
}
