import { track } from "@vercel/analytics/server";
import type { NextRequest } from "next/server";

// Fires a `mcp_tool_call` Web Analytics event when the request carries
// `?via=mcp&tool=<name>` (set by @antfeed/mcp ≥ 0.2.3). Fire-and-forget;
// must never throw into the response path.
export function trackMcpUsage(req: Request | NextRequest, route: string): void {
  const url = new URL(req.url);
  if (url.searchParams.get("via") !== "mcp") return;
  const tool = url.searchParams.get("tool") ?? "unknown";
  void track("mcp_tool_call", { tool, route }).catch(() => {});
}
