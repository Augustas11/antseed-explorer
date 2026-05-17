# MCP usage observability

## What's instrumented
- Every outbound fetch from @antfeed/mcp ≥ 0.2.3 sends `?via=mcp&tool=<name>`
  and `User-Agent: antfeed-mcp/<version>`.
- antfeed.org's API routes that MCP can reach call `track("mcp_tool_call",
  { tool, route })` server-side. (Routes: providers, sellers_services,
  buyers_detail, score, stats, gas, dau.)

## Where to look — Web Analytics (preferred)
- Vercel project → Analytics → Events.
- Filter: `event = mcp_tool_call`.
- Group by `tool` for per-tool call counts; group by `route` for per-route.
- Time range: last 7d / 30d for trend.
- Link: https://vercel.com/<team>/<project>/analytics  (operator fills in
  once verified)

## Where to look — Logs (fallback for debugging)
- Vercel project → Logs.
- Filter: `user-agent contains "antfeed-mcp"`.
- Group by URL path for the per-route breakdown (path → tool mapping is
  1:1 in practice).

## Verifying end-to-end
Run:
    cd antfeed-mcp && npm run build
    node dist/index.js          # starts the stdio server
In a second terminal, send a tool call via @modelcontextprotocol/inspector
or Claude Desktop. Within ~1 minute the corresponding `mcp_tool_call`
event should appear in Vercel Analytics → Events.

## What's intentionally NOT tracked
- Tool arguments (privacy + cardinality)
- Buyer/seller addresses (high-cardinality)
- Anything from /api/cron/*, /api/sync, /api/abi, /api/read-contract —
  those are operator-internal, not MCP-reachable

## Adding new tools
When a new MCP tool is added, the only thing required to keep usage tracking
working is: if the tool hits a *new* upstream API route, add a
`trackMcpUsage(req, "<route>")` call at the top of that route's handler.
No changes needed in @antfeed/mcp itself.
