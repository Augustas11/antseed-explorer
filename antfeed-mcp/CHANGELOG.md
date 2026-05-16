# Changelog

All notable changes to `@antfeed/mcp` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
