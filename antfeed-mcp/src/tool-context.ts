import { AsyncLocalStorage } from "node:async_hooks";

// Per-call context propagated through await boundaries. Set in index.ts on
// every CallTool dispatch; read in ExplorerClient.buildUrl to tag outbound
// requests with `?via=mcp&tool=<name>` so antfeed.org can attribute traffic
// per tool (Vercel logs + Web Analytics) without log-line parsing.
export const toolContext = new AsyncLocalStorage<{ tool: string }>();
