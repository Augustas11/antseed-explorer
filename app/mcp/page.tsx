import type { Metadata } from "next";
import Link from "next/link";
import CopyButton from "./CopyButton";

export const metadata: Metadata = {
  title: "AntFeed MCP — discover and transact on AntSeed from any AI agent",
  description:
    "Model Context Protocol server for the AntFeed Explorer. One line in your Claude Code / Cursor / Claude Desktop config and your agent can list providers, look up addresses, inspect sessions, and open AntSeed channels.",
  openGraph: {
    title: "AntFeed MCP",
    description: "Discover and transact on the AntSeed P2P AI network from any AI agent.",
    url: "https://www.antfeed.org/mcp",
    siteName: "AntSeed Demand Explorer",
    type: "website",
  },
};

const INSTALL_SNIPPET = `{
  "mcpServers": {
    "antfeed": {
      "command": "npx",
      "args": ["-y", "@antfeed/mcp"],
      "env": {
        "ANTFEED_EXPLORER_URL": "https://antfeed.org",
        "ANTSEED_BUYER_URL": "http://localhost:8377"
      }
    }
  }
}`;

const READ_ONLY_TOOLS: { name: string; inputs: string; output: string }[] = [
  {
    name: "lookup",
    inputs: "query, limit?",
    output: "matched providers — substring on address, displayName, OR service name",
  },
  {
    name: "list_providers",
    inputs: "offset?, limit?, sort? (score | recent)",
    output: "provider directory with displayName, services, per-service pricing, region, USDC earned, ghost rate",
  },
  {
    name: "get_pricing",
    inputs: "peerId, service",
    output: "live $/M-token pricing (input + output) from the AntFeed directory; refreshed hourly",
  },
  {
    name: "get_session_status",
    inputs: "sessionId (channel id, hex)",
    output: "on-chain channel state, balance, buyer/seller, settlement",
  },
];

export default function McpPage() {
  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">
          AntFeed <span className="text-accent">MCP</span>
        </h1>
        <p className="text-muted text-sm mt-2 leading-relaxed">
          Give any AI agent — Claude Code, Cursor, Claude Desktop, Cline — a one-line door into the AntSeed network. The{" "}
          <a
            className="text-accent hover:underline"
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noreferrer"
          >
            Model Context Protocol
          </a>{" "}
          server wraps the explorer's REST API plus, optionally, a locally running AntSeed buyer so your agent can open and inspect payment channels without you writing any glue code.
        </p>
      </div>

      <section className="panel p-5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h2 className="font-medium">Install</h2>
          <CopyButton text={INSTALL_SNIPPET} label="Copy JSON" />
        </div>
        <p className="text-xs text-muted">
          Paste into <code className="font-mono">~/.claude.json</code> (Claude Code),{" "}
          <code className="font-mono">claude_desktop_config.json</code> (Claude Desktop), or your IDE's MCP config. Restart your MCP host.
        </p>
        <pre className="bg-bg border border-edge rounded p-4 text-xs font-mono overflow-x-auto leading-relaxed">
          <code>{INSTALL_SNIPPET}</code>
        </pre>
        <p className="text-xs text-muted">
          Node ≥ 20 required. The package ships as{" "}
          <a
            className="text-accent hover:underline"
            href="https://www.npmjs.com/package/@antfeed/mcp"
            target="_blank"
            rel="noreferrer"
          >
            <code className="font-mono">@antfeed/mcp</code>
          </a>{" "}
          on npm. <code className="font-mono">npx -y</code> auto-fetches the latest within the pinned range; restart your MCP host to upgrade.
        </p>
      </section>

      <section className="panel p-5 space-y-3">
        <h2 className="font-medium">Tools</h2>
        <p className="text-xs text-muted">
          All five tools return structured JSON. Inputs are validated with zod before any network call.
        </p>
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Inputs</th>
              <th>Output</th>
            </tr>
          </thead>
          <tbody>
            {READ_ONLY_TOOLS.map((t) => (
              <tr key={t.name}>
                <td>
                  <code className="font-mono text-xs">{t.name}</code>
                </td>
                <td className="text-xs text-muted font-mono">{t.inputs}</td>
                <td className="text-xs text-muted">{t.output}</td>
              </tr>
            ))}
            <tr>
              <td>
                <code className="font-mono text-xs">create_session</code>
              </td>
              <td className="text-xs text-muted font-mono">
                providerPeerId, service, initialDepositUsdc, initialMessage?
              </td>
              <td className="text-xs text-muted">
                Open buyer→seller session via local buyer. Hard-capped by{" "}
                <code className="font-mono">ANTSEED_MAX_DEPOSIT_USDC</code>. Only registered when a buyer responds to <code className="font-mono">/health</code>.
              </td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-muted">
          When no local buyer is detected, <code className="font-mono">create_session</code> is replaced by a diagnostic{" "}
          <code className="font-mono">buyer_setup</code> tool that returns install instructions.
        </p>
      </section>

      <section className="panel p-5 space-y-3">
        <h2 className="font-medium">Environment variables</h2>
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Default</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code className="font-mono text-xs">ANTFEED_EXPLORER_URL</code>
              </td>
              <td className="text-xs font-mono">https://antfeed.org</td>
              <td className="text-xs text-muted">Base URL for the explorer REST API.</td>
            </tr>
            <tr>
              <td>
                <code className="font-mono text-xs">ANTSEED_BUYER_URL</code>
              </td>
              <td className="text-xs font-mono">http://localhost:8377</td>
              <td className="text-xs text-muted">
                Local AntSeed buyer RPC. Use <code className="font-mono">:8378</code> for AntStation Desktop.
              </td>
            </tr>
            <tr>
              <td>
                <code className="font-mono text-xs">ANTSEED_MAX_DEPOSIT_USDC</code>
              </td>
              <td className="text-xs font-mono">10</td>
              <td className="text-xs text-muted">
                Hard ceiling on <code className="font-mono">initialDepositUsdc</code>. Defense-in-depth against prompt-injected agents.
              </td>
            </tr>
            <tr>
              <td>
                <code className="font-mono text-xs">ANTSEED_BUYER_STRICT</code>
              </td>
              <td className="text-xs font-mono">0</td>
              <td className="text-xs text-muted">
                Set to <code className="font-mono">1</code> to require the buyer's{" "}
                <code className="font-mono">/health</code> to identify itself. Recommended on shared dev boxes.
              </td>
            </tr>
            <tr>
              <td>
                <code className="font-mono text-xs">ANTFEED_MCP_TIMEOUT_MS</code>
              </td>
              <td className="text-xs font-mono">8000</td>
              <td className="text-xs text-muted">Per-request timeout in milliseconds.</td>
            </tr>
            <tr>
              <td>
                <code className="font-mono text-xs">ANTFEED_MCP_LOG_LEVEL</code>
              </td>
              <td className="text-xs font-mono">info</td>
              <td className="text-xs text-muted">
                <code className="font-mono">debug</code> · <code className="font-mono">info</code> ·{" "}
                <code className="font-mono">warn</code> · <code className="font-mono">error</code>. Logs go to stderr.
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="panel p-5 space-y-3">
        <h2 className="font-medium">Security model</h2>
        <ul className="text-sm text-muted space-y-2 leading-relaxed list-disc pl-5">
          <li>
            <span className="text-ink">The agent caller is treated as untrusted.</span> Every tool argument is
            zod-validated before any network call: addresses must be <code className="font-mono">0x</code>+40-hex,
            session IDs must be hex, deposit amounts are capped by{" "}
            <code className="font-mono">ANTSEED_MAX_DEPOSIT_USDC</code>.
          </li>
          <li>
            <span className="text-ink">Explorer responses are re-validated</span> against a strict shape, with a
            2 MB byte ceiling per response — a compromised or hijacked endpoint cannot inject arbitrary strings
            into your agent's context or exhaust memory.
          </li>
          <li>
            <span className="text-ink">The local buyer holds your signing key.</span> The MCP never sees it. To
            prevent another local process from impersonating the buyer, set{" "}
            <code className="font-mono">ANTSEED_BUYER_STRICT=1</code> and have your buyer respond to{" "}
            <code className="font-mono">/health</code> with{" "}
            <code className="font-mono">{`{"service":"antseed-buyer"}`}</code>.
          </li>
          <li>
            <span className="text-ink">Minimal install footprint.</span> Tarball ships only the built JS, README
            and LICENSE — no postinstall scripts, no source maps that leak local paths. Dependencies are
            <code className="font-mono"> ~</code>-pinned and published with npm provenance — verify with{" "}
            <code className="font-mono">npm audit signatures</code>.
          </li>
          <li>
            <span className="text-ink">Plain <code className="font-mono">http://</code></span> is only permitted
            for loopback hosts; non-loopback explorer URLs must be <code className="font-mono">https://</code>.
          </li>
        </ul>
      </section>

      <section className="panel p-5 space-y-3">
        <h2 className="font-medium">For sellers</h2>
        <p className="text-sm text-muted leading-relaxed">
          If you already operate an AntSeed seller and you appear in the explorer's{" "}
          <Link href="/providers" className="text-accent hover:underline">
            provider directory
          </Link>
          , you are automatically discoverable through this MCP — no extra registration. New sellers join the
          directory by transacting on-chain; the explorer indexes Base mainnet AntSeed Channels events. The MCP
          forwards your details to every agent that asks.
        </p>
      </section>

      <section className="panel p-5 space-y-3">
        <h2 className="font-medium">Links</h2>
        <ul className="text-sm space-y-1.5">
          <li>
            <a
              className="text-accent hover:underline"
              href="https://www.npmjs.com/package/@antfeed/mcp"
              target="_blank"
              rel="noreferrer"
            >
              npm — @antfeed/mcp
            </a>
          </li>
          <li>
            <a
              className="text-accent hover:underline"
              href="https://github.com/Augustas11/antseed-explorer/tree/main/antfeed-mcp"
              target="_blank"
              rel="noreferrer"
            >
              GitHub source
            </a>
          </li>
          <li>
            <Link className="text-accent hover:underline" href="/docs">
              Explorer REST API docs
            </Link>{" "}
            <span className="text-muted text-xs">(the backend the MCP wraps)</span>
          </li>
          <li>
            <a
              className="text-accent hover:underline"
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noreferrer"
            >
              Model Context Protocol
            </a>{" "}
            <span className="text-muted text-xs">(spec)</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
