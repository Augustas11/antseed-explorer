# @antfeed/mcp

**Discover and transact on the AntSeed P2P AI network from any MCP-compatible AI agent.**

A [Model Context Protocol](https://modelcontextprotocol.io) server that turns the [AntFeed Explorer](https://antfeed.org) into a one-line discovery front door for Claude Code, Cursor, Claude Desktop, and any other MCP host. List sellers, look up provider addresses, inspect on-chain payment channels, and (when a local AntSeed buyer is running) open new sessions — all from inside your agent.

---

## Install

Add the following block to `~/.claude.json` (Claude Code), `claude_desktop_config.json` (Claude Desktop), or your IDE's MCP config:

```json
{
  "mcpServers": {
    "antfeed": {
      "command": "npx",
      "args": ["-y", "@antfeed/mcp"],
      "env": {
        "ANTFEED_EXPLORER_URL": "https://www.antfeed.org",
        "ANTSEED_BUYER_URL": "http://localhost:8377"
      }
    }
  }
}
```

Restart your MCP host. The server boots over stdio and exposes the tools below.

---

## Tools

Every tool returns both `structuredContent` (typed object matching its declared `outputSchema`) and `content[0].text` (the same payload serialized as JSON, for older MCP clients). Annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are exposed so hosts like Claude Desktop / Cursor can render confirm dialogs before destructive calls.

| Tool                  | Inputs                                                                       | Output                                                                                  | Annotations | Requires local buyer? |
| --------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------- | --------------------- |
| `lookup`              | `query`, `limit?` (1–200, default 50), `cursor?`                              | `{ query, matches[], matched, totalMatched, searchedOver, explorerTotal, truncated, nextCursor? }` — matches against **address, displayName, and service names** | readOnly, idempotent | no                    |
| `list_providers`      | `limit?` (1–200, default 50), `cursor?`, `sort?` (`score`\|`recent`)         | `{ providers[], total, sort, nextCursor? }` — each provider includes displayName, region, services, `pricingSummary`, sessionCount, USDC earned, ghost rate | readOnly, idempotent | no                    |
| `get_pricing`         | `peerId`, `service`                                                          | `{ peerId, service, status, currency, inputUsdPerMillion, outputUsdPerMillion, displayName, region, lastUpdated }` — **live pricing** from the AntFeed directory | readOnly, idempotent | no                    |
| `get_session_status`  | `sessionId` (channel_id, bytes32 hex)                                        | `{ sessionId, buyer, seller, status, channelBalance, settledAmountUsdc, totalDeltaUsdc, eventCount, settled, openedAt, closedAt }` | readOnly | no                    |
| `network_stats`       | _(none)_                                                                     | `{ revenueUsdc, dau, drift, gasGwei, asOf, partialFailures[] }` — point-in-time snapshot (parallel-fetches `/api/stats` + `/api/gas` + `/api/metrics/dau` for today; per-endpoint failures degrade the field to `null` and are listed in `partialFailures`) | readOnly | no                    |
| `get_buyer`           | `address`                                                                    | `{ address, qualified, trustScore{…}, sessions{total, settledUsdc, monthlyVolume[]}, recentSessions[≤20], topSellers[] }` | readOnly, idempotent | no                    |
| `dau_trend`           | `from?` (ISO date), `to?` (ISO date), `granularity?` (`day`)                 | `{ from, to, granularity, series[{date, dau, dauBuyers, dauSellers, newUsers}] }` — default window: last 30 days | readOnly | no                    |
| `create_session`      | `providerPeerId`, `service`, `initialDepositUsdc`, `initialMessage?`         | `{ sessionId, status, channelAddress?, txHash? }` from the local buyer                  | **destructive** | **yes**               |
| `buyer_setup`         | _(none)_                                                                     | Diagnostic instructions for installing a local AntSeed buyer                            | readOnly | exposed _instead of_ `create_session` when no buyer is detected at startup |

### Example: list top providers

```jsonc
// tool call
{ "name": "list_providers", "arguments": { "limit": 3, "sort": "score" } }
```

Returns the top three sellers ranked by total USDC earned. To paginate, pass back the returned `nextCursor` as `cursor` on the next call.

### Data sources

The MCP wraps the following AntFeed Explorer endpoints:

- `GET /api/providers` — provider directory (displayName, services, per-service pricing, region, on-chain aggregates). Refreshed hourly from `network.antseed.com`. Backs `list_providers` and `lookup`.
- `GET /api/sellers/{address}/services` — one seller's service catalog + live pricing. Backs `get_pricing`.
- `GET /api/channels` — on-chain payment channel records. Backs `get_session_status`.
- `GET /api/stats` — network-wide aggregates (revenue, sessions, drift). Backs `network_stats`.
- `GET /api/gas` — current Base gas price. Backs `network_stats`.
- `GET /api/buyers/{address}` + `GET /api/score/{address}` — buyer profile, session history, top sellers, and trust-score breakdown. Backs `get_buyer`.
- `GET /api/metrics/dau` — daily active users, by UTC day. Backs `dau_trend` and the DAU field in `network_stats`.

A few small client-side adaptations remain:

- No server-side `/api/search` yet → `lookup` performs **client-side substring matching** over the top page of `/api/providers` (matching against address, displayName, and service names). A future server-side endpoint will let `lookup` scale past 1000 providers — the MCP will switch over without any client changes.
- No per-channel `/api/channels/{id}` yet → `get_session_status` paginates `/api/channels` (sorted by `last_activity desc`) and filters client-side. Channels deeper than 5000 records may return `SESSION_OUT_OF_RANGE`.

---

## Config

All values are optional. Resolution order: `--config file.json` → environment variable → built-in default.

| Variable                  | Default                  | Purpose                                                                 |
| ------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `ANTFEED_EXPLORER_URL`    | `https://www.antfeed.org` | Base URL for the AntFeed Explorer REST API.                             |
| `ANTSEED_BUYER_URL`       | `http://localhost:8377`  | Local AntSeed CLI buyer RPC. Use `http://localhost:8378` for AntStation Desktop. |
| `ANTFEED_MCP_TIMEOUT_MS`  | `8000`                   | Per-request timeout for explorer and buyer calls.                       |
| `ANTFEED_MCP_LOG_LEVEL`   | `info`                   | One of `debug`, `info`, `warn`, `error`. Logs go to `stderr` (stdout is reserved for MCP stdio). |
| `ANTSEED_BUYER_STRICT`    | `0`                      | Set to `1` to require the local buyer's `/health` response to identify itself as `{"service":"antseed-buyer"}` or `{"service":"antstation"}`. When unset, the MCP accepts any 200 response and warns once on stderr. Recommended on shared dev boxes. |
| `ANTSEED_MAX_DEPOSIT_USDC` | `10`                    | Hard ceiling on `initialDepositUsdc` in `create_session`. Defense-in-depth against a prompt-injected agent moving large amounts. The buyer enforces its own auth on top; this is a belt-and-suspenders MCP-side cap. |

You can also pass `--config path/to/config.json` with the same keys (camelCase: `explorerUrl`, `buyerUrl`, `timeoutMs`, `logLevel`, `buyerStrict`, `maxDepositUsdc`).

---

## Buyer auto-detect

On startup the server probes `GET <ANTSEED_BUYER_URL>/health` with a 500 ms timeout:

- **reachable** → registers `create_session`.
- **not reachable** → registers `buyer_setup` (a diagnostic tool with install instructions) **instead**, and `create_session` is omitted from the tool list.

Detection runs **once** at startup. Restart the MCP host after installing or starting a buyer.

---

## Error model

Every tool returns either a successful structured payload or an MCP error result with `isError: true` and a structured body of shape:

```json
{ "error": { "code": "EXPLORER_DOWN", "message": "..." } }
```

| Code                 | Meaning                                                    |
| -------------------- | ---------------------------------------------------------- |
| `INVALID_INPUT`      | Zod validation failed for the tool arguments.              |
| `EXPLORER_DOWN`      | Network error or timeout calling the explorer.             |
| `EXPLORER_HTTP_<n>`  | Explorer returned a non-2xx status (e.g. `EXPLORER_HTTP_404`). |
| `RATE_LIMITED`       | Explorer returned 429.                                     |
| `EXPLORER_INVALID_JSON` | Response body was not JSON.                             |
| `BUYER_DOWN`         | Local buyer not reachable.                                 |
| `BUYER_HTTP_<n>`     | Local buyer returned a non-2xx status.                     |
| `BUYER_INVALID_JSON` | Buyer response body was not JSON.                          |
| `SESSION_NOT_FOUND`  | `get_session_status` could not locate the channel.         |
| `BUYER_NOT_FOUND`    | `get_buyer` could not find the address in the explorer's index. |
| `INVALID_CURSOR`     | `cursor` argument is not a valid pagination token returned by a previous call. Surfaced as `INVALID_INPUT`. |
| `INTERNAL`           | Anything else (sanitized; no stack traces or env values).  |

---

## Security model

Installing `@antfeed/mcp` is an explicit trust decision. Read this section before letting an autonomous agent call its tools.

- **The agent caller is treated as untrusted.** Every tool argument is validated by a strict zod schema before any network call. `peerId`/`providerPeerId` must be `0x` + 40 hex chars; `sessionId` must be `0x` + 1–128 hex chars; `service` is bounded to a short identifier; `initialDepositUsdc` is hard-capped by `ANTSEED_MAX_DEPOSIT_USDC` (default 10 USDC). A prompt-injected agent cannot move arbitrary amounts or craft URL/path-traversal payloads through this MCP.
- **The explorer is treated as semi-trusted.** Every response from `ANTFEED_EXPLORER_URL` is re-validated against a strict zod shape — addresses must be 40-hex, channel IDs must be hex, numeric fields must be finite. Responses are streamed with a 2 MB byte cap so a compromised or hijacked endpoint cannot exhaust memory. Plain `http://` is only permitted for loopback hosts; non-loopback URLs must be `https://`.
- **The local buyer holds your signing key; this MCP never sees it.** The MCP only ever POSTs `create_session` (with bounded deposit, validated input) to the buyer URL — it does not read or store any key material. To prevent another local process from impersonating the buyer (e.g. on shared/multi-tenant dev boxes), set `ANTSEED_BUYER_STRICT=1` and have your buyer respond to `/health` with `{"service":"antseed-buyer"}`.
- **The package itself ships minimally.** `dist/`, README, LICENSE — no postinstall scripts, no test files, no source maps that leak local paths. `npm audit --omit=dev` reports zero production-tree vulnerabilities. Dependencies are pinned to `~` ranges; on publish, the package is signed with npm provenance so consumers can verify the tarball came from this repo (`npm audit signatures`).
- **Error messages are sanitized.** File paths, IP addresses, and `UPPER_CASE_VAR=…` patterns are scrubbed before any error reaches the agent or the MCP host's logs.

If you spot a security concern, please [open a private GitHub Security Advisory](https://github.com/Augustas11/antseed-explorer/security/advisories/new) — we triage these within 72 hours. Do not file a public issue for security-impacting bugs.

## For sellers

If you already operate an AntSeed seller and you appear in the [AntFeed Explorer](https://antfeed.org) directory, you are automatically discoverable through this MCP — no extra registration. New sellers join the directory by simply transacting on-chain (the explorer indexes Base mainnet AntSeed Channels events). Once `/api/services` and `/api/sellers/{address}/services` land, `get_pricing` and `list_providers#servicesOffered` will populate without any client changes.

---

## Develop

```bash
npm install
npm run build         # tsc → dist/
npm test              # vitest, fully mocked, zero network
node dist/index.js    # stdio server (MCP host wires this up; not interactive)
```

Smoke test the MCP handshake with the official inspector:

```bash
npx @modelcontextprotocol/inspector dist/index.js
```

---

## Registry submission

The package is submitted to the public MCP server registries (registry.modelcontextprotocol.io, Smithery, PulseMCP, Glama, mcp.so) so any MCP-aware client can discover and install it without copy-pasting the snippet above. Source of truth for the official registry submission is [`server.json`](./server.json); the Smithery descriptor is [`smithery.yaml`](./smithery.yaml). The full submission checklist with current URLs lives in [`REGISTRIES.md`](./REGISTRIES.md). Registry repo: <https://github.com/modelcontextprotocol/registry>.

For per-tool usage observability on the Vercel dashboard, see [`USAGE.md`](./USAGE.md).

## Links

- AntFeed Explorer: <https://antfeed.org>
- AntFeed Explorer API docs (OpenAPI 3.0): <https://antfeed.org/api/openapi.json>
- AntSeed protocol contracts (Base mainnet): see the Explorer's About page

## License

MIT
