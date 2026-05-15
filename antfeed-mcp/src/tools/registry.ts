import { buyerSetupTool } from "./buyer-setup.js";
import { createSessionTool } from "./create-session.js";
import { getPricingTool } from "./get-pricing.js";
import { getSessionStatusTool } from "./get-session-status.js";
import { listProvidersTool } from "./list-providers.js";
import { lookupTool } from "./lookup.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export const READ_ONLY_TOOLS: readonly ToolDef[] = [
  lookupTool,
  listProvidersTool,
  getPricingTool,
  getSessionStatusTool,
];

export function buildTools(buyerReachable: boolean): ToolDef[] {
  return [...READ_ONLY_TOOLS, buyerReachable ? createSessionTool : buyerSetupTool];
}
