# Registry submission checklist

Distribution surface for `@antfeed/mcp`. Each row is one manual step the
operator runs after this version ships to npm. Re-check the URLs at submit
time — they drift.

| # | Registry | Status | Action |
|---|----------|--------|--------|
| 1 | **registry.modelcontextprotocol.io** (official) | [x] | Submitted via the `mcp-publisher` CLI (<https://github.com/modelcontextprotocol/registry>). Source of truth: [`server.json`](./server.json). Namespace `io.github.Augustas11/*` (case-sensitive — must match GitHub username casing) is verified via GitHub OAuth at publish time. Re-publish on a version bump: `mcp-publisher login github && mcp-publisher publish` from this directory. |
| 2 | **Smithery** | [ ] | Push [`smithery.yaml`](./smithery.yaml), then submit at <https://smithery.ai/new>. Docs: <https://smithery.ai/docs/build/publish>. |
| 3 | **PulseMCP** | [ ] | Submit via <https://www.pulsemcp.com/submit>. PulseMCP also ingests from the official registry, so step 1 may auto-populate this within a week. |
| 4 | **Glama** | [ ] | Submit via <https://glama.ai/mcp/servers/add>. |
| 5 | **mcp.so** | [ ] | Auto-indexed from npm + GitHub. Verify listing appears at <https://mcp.so/server/antfeed-mcp> after publish; submit manually if not picked up within 48h. |
| 6 | **Claude Desktop catalog** | [ ] | No direct submission. Indexed downstream from the official registry — verify appearance in the in-app catalog after step 1 propagates. |
| 7 | **Cursor MCP marketplace** | [ ] | Curated by Cursor; no public submission portal. Verify listing at <https://cursor.com/en/marketplace>; otherwise ping Cursor via their feedback channel. |

## Notes

- **Single source of truth for the official registry:** `server.json` in this
  directory. Update its `version` field in lockstep with `package.json` and
  re-publish before submitting to step 1.
- **Description drift:** the canonical one-liner is `package.json` →
  `description`. README h1 tagline and the `/mcp` page OG/Twitter copy are
  shorter marketing variants and intentionally do not match verbatim.
- **Cleaning up:** if a listing on PulseMCP/Glama/mcp.so goes stale (wrong
  version, wrong description), most accept update requests via the same
  submission flow; the official registry update happens by re-running
  `mcp-publisher` on a bumped `server.json`.
