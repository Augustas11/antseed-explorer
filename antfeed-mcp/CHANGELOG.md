# Changelog

All notable changes to `@antfeed/mcp` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.2.5 — 2026-05-24

### Fixed

- **`npx -y @antfeed/mcp` failing with `command not found`.** The `prepare` script ran `tsc` on consumer install (no devDeps available), silently failing and preventing the bin symlink. Changed to `prepublishOnly` so it only runs during development.

## 0.2.4 — 2026-05-24

### Fixed

- **`list_providers` and `lookup` failing with `EXPLORER_BAD_RESPONSE`.** The default `explorerUrl` pointed at `https://antfeed.org`, which 307-redirects to `https://www.antfeed.org`. Some fetch environments parsed the redirect body instead of following, breaking both provider tools. Default is now the canonical `https://www.antfeed.org` URL, and all fetch calls explicitly set `redirect: "follow"` as defense-in-depth.

## 0.2.3 — 2026-05-17

### Added

- **Per-tool attribution on outbound requests.** Every fetch into the antfeed.org explorer API now carries `?via=mcp&tool=<tool_name>` so the upstream can split MCP traffic by tool in server logs and Vercel Web Analytics without `User-Agent` parsing. Implemented via `AsyncLocalStorage` (`src/tool-context.ts`); the tool name is set once at the MCP `CallToolRequest` dispatch and propagates through every awaited fetch in `ExplorerClient`. Local-buyer calls (`create_session`) are not tagged — they don't hit the public surface.

### Fixed

- **`User-Agent` version drift.** `PACKAGE_VERSION` in `src/index.ts` was still `"0.2.1"` after the 0.2.2 publish, so the outbound `User-Agent` mis-reported the client version. Bumped to `0.2.3` and synced with `package.json`.

## 0.2.2 — 2026-05-17

### Added

- **`mcpName` field** in `package.json` set to `io.github.Augustas11/antfeed-mcp`. Required by the official MCP registry (`registry.modelcontextprotocol.io`) to co-attest that this npm package is the implementation behind the registry listing. No runtime behavior change.

## 0.2.1 — 2026-05-17

### Added

- **Server `instructions` field** on the MCP `initialize` response (per MCP spec 2025-06-18). Hosts like Claude Desktop, Cursor, and Claude Code surface this string as a system-prompt-style preamble the agent sees on connect — gives the model a short task-shaped map of when to call which tool, which materially improves multi-step flows on servers with many tools.

## 0.2.0 — 2026-05-17

Quality pass on every tool plus three new read tools that fill the biggest gaps in MCP coverage of antfeed.org's public data. Optimized against MCP spec 2025-06-18 (`annotations`, `outputSchema`) so tools behave well in Claude Desktop / Cursor / Smithery: clients can render confirm dialogs before destructive calls, validate responses against a declared schema, and consume `structuredContent` directly instead of re-parsing the text payload.

### Added

- **`network_stats`** — one-shot snapshot of antfeed: settled revenue, today's DAU, indexer→profile drift, current Base gas price. Parallel-fetches `/api/stats`, `/api/gas`, and `/api/metrics/dau`. Use for "state of the network right now"; use `dau_trend` for trends. Each upstream is independent: a per-endpoint failure degrades that field to `null` and is reported in `partialFailures: string[]` rather than failing the whole snapshot.
- **`get_buyer`** — symmetric to provider lookup but for buyers. Returns trust-score breakdown (volume / consistency / diversity / reliability), aggregate session stats, the last 20 recent settled sessions, and the buyer's top sellers by spend. Parallel-fetches `/api/buyers/[address]` + `/api/score/[address]`; degrades gracefully when the score endpoint is rate-limited.
- **`dau_trend`** — daily active users between two ISO dates (default: last 30 days). Returns per-day total DAU plus buyer/seller breakdown and new-user count. Backed by `/api/metrics/dau`.

### Changed

- **Tool annotations (MCP 2025-06-18).** Every tool registration now includes the `annotations` hint object: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, `title`. `create_session` is marked `destructiveHint=true` so MCP hosts can show a confirm prompt before the call.
- **Structured output.** Every tool now declares an `outputSchema` and returns both `structuredContent` (typed object) and `content[0].text` (serialized JSON, for clients that haven't migrated). Older clients see no change; newer clients can validate responses against the declared schema and skip the text round-trip.
- **Cursor pagination on `list_providers` and `lookup`.** Replaces the prior `offset` / `limit` shape with an opaque base64url `cursor` token. Default page size 50 (was 20 on `list_providers`, 10 on `lookup`); hard cap 200. The response includes `nextCursor` when more results exist; agents page by passing it back as `cursor`. Lookup paginates over the filtered match set, not the underlying directory page. The old `offset` parameter is removed — this is a breaking change for direct callers of those two tools.
- **Trimmed response payloads.** Tool responses no longer echo raw upstream JSON. Dropped: provider `pricing` full map (kept the `pricingSummary` derived from it), `score` duplicate (kept inside `pricingSummary`), `messagesDelivered`/`lastTxHash`/`service` placeholders on `get_session_status` (they were always `null`/null-equivalent in v1). The shape now matches each tool's declared `outputSchema`.
- **Description audit.** Every tool description was rewritten to the pattern *"[verb] [object] — when to use this vs. similar tools. Returns X."* with enum values inlined. The aim is to fix the most common defect in MCP tool descriptions in the wild: unclear purpose vs. sibling tools.

## 0.1.2 — 2026-05-16

### Added

- Outbound HTTP requests from both the explorer client and the buyer client now send a versioned `User-Agent: antfeed-mcp/<version>` header. This lets us attribute MCP-originated traffic in server logs and triage by client version when responding to issues.
- Every tool description now ends with `Feedback or issues: https://antfeed.org/mcp#feedback`, and the `/mcp` landing page has a new `#feedback` section with a direct mailto and an `@AntFeed` link — giving agents a discoverable, in-band channel for surfacing complaints.

### Changed (internal API surface)

- `ExplorerConfig.userAgent` and `BuyerConfig.userAgent` are now **required** fields (previously optional with an unversioned default). Direct constructors of `ExplorerClient` / `BuyerClient` must pass a versioned UA; the stdio entry point already does. This prevents a silent-degradation path where an external importer would hit upstream APIs with an unversioned `antfeed-mcp` and break our log-triage story.
- `detectBuyer(baseUrl, ...)` was refactored from a five-positional-argument signature to an options-object signature (`detectBuyer(baseUrl, { timeoutMs?, mode?, fetchImpl?, userAgent? })`). Easier to extend without growing more positional params.

## 0.1.1 — 2026-05-15

### Fixed

- Server failed to start when launched through a bin symlink — the standard `npx -y @antfeed/mcp` and `node_modules/.bin/antfeed-mcp` invocation paths. `isMainModule()` compared `process.argv[1]` to `import.meta.url`, but Node resolves symlinks for module URLs while leaving `argv[1]` as the symlink path, so the check returned `false` and `main()` was never called. The server connected to stdio briefly then exited with no handshake, surfacing as `-32000 failed` in MCP clients (e.g. Claude Code). `realpathSync()` now normalizes the entry path before comparing.

## 0.1.0 — 2026-05-15

Initial release. Model Context Protocol server for the [AntFeed Explorer](https://antfeed.org), giving any MCP-compatible AI agent a one-line door into the AntSeed P2P AI network.

### Added

- **Always-on tools** (read-only):
  - `lookup` — fuzzy search over the AntFeed provider directory; matches against address, displayName, and service names.
  - `list_providers` — paginated directory with displayName, region, services, **per-service pricing**, on-chain aggregates.
  - `get_pricing` — **live $/M-token pricing** (input + output) for a (peerId, service) pair. Returns `INDEXED` for advertised prices, `PROVIDER_NOT_INDEXED` / `SERVICE_NOT_OFFERED` / `PRICE_NOT_PUBLISHED` for the edge cases. Source: AntFeed provider directory, refreshed hourly from `network.antseed.com`.
  - `get_session_status` — on-chain channel state by channel ID.
- **Conditional tools** (registered based on local buyer detection at startup):
  - `create_session` — open a new buyer→seller session via the local AntSeed buyer at `localhost:8377`. Deposit hard-capped by `ANTSEED_MAX_DEPOSIT_USDC` (default 10).
  - `buyer_setup` — diagnostic alternative; surfaces install instructions when no buyer is detected.
- Stdio transport via `@modelcontextprotocol/sdk`. Node ≥ 20 required.
- Configurable via env vars (`ANTFEED_EXPLORER_URL`, `ANTSEED_BUYER_URL`, `ANTFEED_MCP_TIMEOUT_MS`, `ANTFEED_MCP_LOG_LEVEL`, `ANTSEED_BUYER_STRICT`, `ANTSEED_MAX_DEPOSIT_USDC`) or a `--config path/to/config.json` file.

### Security

- Strict zod validation on every tool input: Ethereum addresses regex-bounded (`^0x[0-9a-fA-F]{40}$`), service IDs character-bounded, message length-bounded.
- Strict zod re-validation of every upstream response from both the explorer and the local buyer; unexpected shapes are rejected before agent context is touched.
- Per-response byte ceiling (2 MB explorer, 256 kB buyer); response streams are aborted rather than buffered when the cap is hit.
- `http://` URLs only permitted for loopback hosts; non-loopback explorer URLs must be `https://`.
- Optional buyer identity probe (`ANTSEED_BUYER_STRICT=1`) requires the buyer's `/health` to return `{"service":"antseed-buyer"}` — prevents another local process from impersonating the buyer.
- `ANTSEED_MAX_DEPOSIT_USDC` defense-in-depth cap on `create_session` deposits (default 10 USDC, hard-capped at 10 000).
- All error messages routed through a sanitizer that strips file paths, IPv4 addresses, and `UPPER_CASE_VAR=` patterns.
- Defensive prototype-pollution guard on `--config` JSON parsing.
- Published with npm provenance attestation; consumers can verify with `npm audit signatures @antfeed/mcp`.
- Defensive package names `antseed-mcp` and `antfeed` are registered as deprecated typosquats that redirect to this package.

### Notes

- The MCP adapts to the explorer's current REST surface (`/api/sellers`, `/api/channels`, `/api/score`, `/api/stats`). A server-side `/api/search` endpoint and per-service pricing endpoints are planned upstream — when they land, this package will switch to them transparently.
