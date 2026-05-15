# Changelog

All notable changes to `@antfeed/mcp` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 — 2026-05-15

Initial release. Model Context Protocol server for the [AntFeed Explorer](https://antfeed.org), giving any MCP-compatible AI agent a one-line door into the AntSeed P2P AI network.

### Added

- **Always-on tools** (read-only):
  - `lookup` — fuzzy search over the AntFeed seller directory (client-side substring on address; server-side `/api/search` planned).
  - `list_providers` — paginated provider directory ranked by USDC earned or recency.
  - `get_pricing` — placeholder returning `NOT_INDEXED`; will populate when the explorer exposes per-service pricing.
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
