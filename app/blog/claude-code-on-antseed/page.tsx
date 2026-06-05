import type { Metadata } from "next";
import Link from "next/link";
import CopyButton from "@/app/mcp/CopyButton";
import { siteUrl, getSiteOrigin } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const title = "Route Claude Code through the AntSeed P2P network";
  const description =
    "Set up Claude Code (and Aider) to route inference through AntSeed in under five minutes. No API key, USDC settlement, automatic provider selection.";
  const ogTitle = "Route Claude Code through AntSeed";
  const ogDescription =
    "Point your coding agent at the AntSeed P2P network. Five-minute setup, USDC settlement, no API key required.";

  return {
    title,
    description,
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url: siteUrl(await getSiteOrigin(), "/blog/claude-code-on-antseed"),
      siteName: "AntSeed Demand Explorer",
      type: "article",
      publishedTime: "2026-05-25T00:00:00Z",
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: ogDescription,
    },
  };
}

const ENV_CLAUDE_CODE = `export ANTHROPIC_BASE_URL=http://localhost:8377
claude`;

const ENV_AIDER = `export ANTHROPIC_BASE_URL=http://localhost:8377
aider --model claude-sonnet-4-6`;

const CURL_EXAMPLE = `curl http://localhost:8377/v1/messages \\
  -H "content-type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello from AntSeed"}]
  }'`;

/* ── Real terminal captures from a running buyer ────────── */
const TERMINAL_BALANCE = `$ antseed buyer balance
Wallet: 0xDDB6...c61442

USDC Balance (wallet): 6.003914 USDC

Deposits Account:
  Available:           1.0 USDC
  Reserved:            0.0 USDC`;

const TERMINAL_STATUS = `$ antseed buyer status
 Metric                 Value
 Connection state       connected
 Proxy port             8377
 Pinned peer            80d1e7b9b6eb...46288cd
 Deposits available     0.0 USDC
 Deposits reserved      1.0 USDC
 Active channels        1
 Wallet address         0xDDB6...c61442`;

const TERMINAL_RESPONSE = `$ curl localhost:8377/v1/chat/completions \\
    -H "content-type: application/json" \\
    -d '{"model":"deepseek-chat","max_tokens":100, \\
         "messages":[{"role":"user","content":"Write a haiku about P2P networks."}]}'

{
  "id": "chatcmpl-RAmS8CoJYaJIdOQzG4kiStcG",
  "model": "deepseek-chat",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "Nodes hum in the dark,\\nShared paths weave through silent streams—\\nTrust blooms, link by link."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 18,
    "completion_tokens": 23,
    "estimated_cost": 0.0000036
  }
}`;

export default function BlogPost() {
  return (
    <article className="space-y-10 max-w-3xl">
      {/* ── Header ──────────────────────────────────────────── */}
      <header>
        <p className="text-xs text-muted uppercase tracking-wider mb-2">
          Guide &middot; May 25, 2026
        </p>
        <h1 className="text-2xl md:text-3xl font-semibold leading-tight">
          Route Claude Code through the AntSeed{" "}
          <span className="text-accent">P2P network</span>
        </h1>
        <p className="text-muted mt-3 leading-relaxed">
          Claude Code, Aider, and any harness that speaks the Anthropic or
          OpenAI API can route inference through AntSeed with two environment
          variables. No API key. No account signup. Requests go peer-to-peer to
          independent providers and settle in USDC on Base.
        </p>
      </header>

      {/* ── Why this matters ────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Why this matters</h2>
        <ul className="text-sm text-muted space-y-2 leading-relaxed list-disc pl-5">
          <li>
            <span className="text-ink">No vendor account required.</span>{" "}
            Your buyer wallet is your identity. Fund it with USDC on Base and
            start sending requests.
          </li>
          <li>
            <span className="text-ink">Provider neutrality.</span>{" "}
            The buyer&rsquo;s router auto-selects providers based on price,
            latency, and reputation. If one goes down, the next one picks up
            the request &mdash; invisible to your harness.
          </li>
          <li>
            <span className="text-ink">USDC settlement.</span>{" "}
            Per-session billing on Base. No invoices, no monthly bills, no
            credit card on file. You deposit what you want to spend.
          </li>
          <li>
            <span className="text-ink">Same API, different pipe.</span>{" "}
            The AntSeed buyer exposes standard{" "}
            <code className="font-mono text-xs">/v1/messages</code> (Anthropic)
            and{" "}
            <code className="font-mono text-xs">/v1/chat/completions</code>{" "}
            (OpenAI) endpoints. Any tool that respects{" "}
            <code className="font-mono text-xs">ANTHROPIC_BASE_URL</code> or{" "}
            <code className="font-mono text-xs">OPENAI_BASE_URL</code> works
            without code changes.
          </li>
        </ul>
      </section>

      {/* ── Setup ───────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-lg font-medium">The five-minute setup</h2>

        {/* Step 1 */}
        <div className="panel p-5 space-y-3">
          <h3 className="font-medium">
            <span className="text-accent mr-2">1.</span>Install the AntSeed CLI
          </h3>
          <p className="text-sm text-muted">
            Requires Node.js 20+. Works on macOS, Linux, and Windows (WSL).
          </p>
          <div className="flex items-start justify-between gap-3">
            <pre className="bg-bg border border-edge rounded p-4 text-xs font-mono overflow-x-auto flex-1">
              <code>npm install -g @antseed/cli</code>
            </pre>
            <CopyButton text="npm install -g @antseed/cli" label="Copy" />
          </div>
          <p className="text-sm text-muted">
            Verify with{" "}
            <code className="font-mono text-xs">antseed --version</code>.
            AntStation Desktop is also available for{" "}
            <a
              className="text-accent hover:underline"
              href="https://github.com/AntSeed/antseed/releases/latest"
              target="_blank"
              rel="noreferrer"
            >
              macOS and Windows
            </a>
            ; it runs the buyer on port 8378 instead of 8377.
          </p>
        </div>

        {/* Step 2 */}
        <div className="panel p-5 space-y-3">
          <h3 className="font-medium">
            <span className="text-accent mr-2">2.</span>Start the buyer
          </h3>
          <div className="flex items-start justify-between gap-3">
            <pre className="bg-bg border border-edge rounded p-4 text-xs font-mono overflow-x-auto flex-1">
              <code>antseed buyer start</code>
            </pre>
            <CopyButton text="antseed buyer start" label="Copy" />
          </div>
          <p className="text-sm text-muted">
            This starts a local proxy at{" "}
            <code className="font-mono text-xs">http://localhost:8377</code>{" "}
            that speaks both the Anthropic Messages API and the OpenAI Chat
            Completions API. On first run, it generates a secp256k1 key at{" "}
            <code className="font-mono text-xs">~/.antseed/identity.key</code>{" "}
            &mdash; this is your on-chain wallet. Back it up.
          </p>
        </div>

        {/* Step 3 */}
        <div className="panel p-5 space-y-3">
          <h3 className="font-medium">
            <span className="text-accent mr-2">3.</span>Fund your wallet
          </h3>
          <div className="flex items-start justify-between gap-3">
            <pre className="bg-bg border border-edge rounded p-4 text-xs font-mono overflow-x-auto flex-1">
              <code>antseed payments</code>
            </pre>
            <CopyButton text="antseed payments" label="Copy" />
          </div>
          <p className="text-sm text-muted">
            Opens a browser at{" "}
            <code className="font-mono text-xs">localhost:3118</code>.
            Connect any wallet (MetaMask, Coinbase Wallet, etc.), deposit USDC
            on Base. A few dollars is enough to start. Anyone can deposit on
            behalf of a buyer &mdash; useful for team treasuries.
          </p>
          <p className="text-sm text-muted">
            Check your balance anytime with{" "}
            <code className="font-mono text-xs">antseed buyer balance</code>:
          </p>
          <div className="bg-bg border border-edge rounded p-4 text-xs font-mono overflow-x-auto leading-relaxed text-muted">
            <pre>{TERMINAL_BALANCE}</pre>
          </div>
        </div>

        {/* Step 4 */}
        <div className="panel p-5 space-y-3">
          <h3 className="font-medium">
            <span className="text-accent mr-2">4.</span>Point Claude Code at
            the buyer
          </h3>
          <div className="flex items-start justify-between gap-3">
            <pre className="bg-bg border border-edge rounded p-4 text-xs font-mono overflow-x-auto flex-1">
              <code>{ENV_CLAUDE_CODE}</code>
            </pre>
            <CopyButton text={ENV_CLAUDE_CODE} label="Copy" />
          </div>
          <p className="text-sm text-muted">
            That&rsquo;s it. Claude Code reads{" "}
            <code className="font-mono text-xs">ANTHROPIC_BASE_URL</code> and
            sends all inference requests to your local buyer instead of
            Anthropic&rsquo;s API. The buyer finds a provider on the AntSeed
            network that serves the requested model, opens a payment channel,
            and proxies the response back.
          </p>
        </div>
      </section>

      {/* ── Aider config ────────────────────────────────────── */}
      <section className="panel p-5 space-y-3">
        <h3 className="font-medium">Same setup for Aider</h3>
        <p className="text-sm text-muted">
          Aider also reads{" "}
          <code className="font-mono text-xs">ANTHROPIC_BASE_URL</code>. Point
          it at the buyer and specify a model available on the network:
        </p>
        <div className="flex items-start justify-between gap-3">
          <pre className="bg-bg border border-edge rounded p-4 text-xs font-mono overflow-x-auto flex-1">
            <code>{ENV_AIDER}</code>
          </pre>
          <CopyButton text={ENV_AIDER} label="Copy" />
        </div>
        <p className="text-sm text-muted">
          Any tool that respects{" "}
          <code className="font-mono text-xs">OPENAI_BASE_URL</code> works the
          same way &mdash; the buyer serves OpenAI-compatible endpoints at the
          same address.
        </p>
      </section>

      {/* ── Verify with curl ────────────────────────────────── */}
      <section className="panel p-5 space-y-3">
        <h3 className="font-medium">Verify with curl</h3>
        <p className="text-sm text-muted">
          Before wiring up a full harness, confirm the buyer is working:
        </p>
        <div className="flex items-start justify-between gap-3">
          <pre className="bg-bg border border-edge rounded p-4 text-xs font-mono overflow-x-auto flex-1 leading-relaxed">
            <code>{CURL_EXAMPLE}</code>
          </pre>
          <CopyButton text={CURL_EXAMPLE} label="Copy" />
        </div>
        <p className="text-sm text-muted">
          You should get a standard API response. No API key header needed
          &mdash; the buyer handles auth via your on-chain identity.
        </p>
        <p className="text-xs text-muted mt-2">Example response from a live buyer:</p>
        <div className="bg-bg border border-edge rounded p-4 text-xs font-mono overflow-x-auto leading-relaxed text-muted mt-2">
          <pre>{TERMINAL_RESPONSE}</pre>
        </div>
      </section>

      {/* ── What just happened ──────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">What just happened</h2>
        <p className="text-sm text-muted leading-relaxed">
          When Claude Code sends a request to{" "}
          <code className="font-mono text-xs">localhost:8377/v1/messages</code>,
          the buyer:
        </p>
        <ol className="text-sm text-muted space-y-2 leading-relaxed list-decimal pl-5">
          <li>
            Looks up providers on the AntSeed DHT that advertise the requested
            model (e.g.{" "}
            <code className="font-mono text-xs">claude-sonnet-4-6</code>).
          </li>
          <li>
            Scores them by price (30%), latency (25%), capacity (20%),
            reputation (10%), freshness (10%), and reliability (5%) &mdash; then
            picks the best match.
          </li>
          <li>
            Opens a payment channel on Base, locking a small USDC reserve for
            the session.
          </li>
          <li>
            Forwards the request peer-to-peer. The provider runs inference and
            streams the response back.
          </li>
          <li>
            Meters token usage. When the session reserve runs out, it settles
            on-chain and opens a new one transparently.
          </li>
        </ol>
        <p className="text-sm text-muted leading-relaxed">
          If a provider fails mid-request, the router switches to the next-best
          candidate. Because the API is stateless, this is invisible to your
          harness. Here&rsquo;s what the buyer looks like with an active session:
        </p>
        <div className="bg-bg border border-edge rounded p-4 text-xs font-mono overflow-x-auto leading-relaxed text-muted">
          <pre>{TERMINAL_STATUS}</pre>
        </div>

        <div className="panel p-5 text-xs font-mono text-muted leading-relaxed">
          <pre>{`Claude Code / Aider / any harness
        │
        │  ANTHROPIC_BASE_URL or OPENAI_BASE_URL
        ▼
  local buyer  (localhost:8377)
        │
        │  auto-routed, encrypted P2P
        ▼
  provider on AntSeed network
        │
        │  inference + token metering
        ▼
  USDC settlement on Base`}</pre>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">What does it cost?</h2>
        <p className="text-sm text-muted leading-relaxed">
          Prices are set by individual providers and vary. Here are three
          providers currently serving Claude models on the network, pulled live
          from the{" "}
          <Link href="/providers" className="text-accent hover:underline">
            provider directory
          </Link>{" "}
          (as of May 25, 2026):
        </p>

        <div className="panel overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
                <th>Input $/M tokens</th>
                <th>Output $/M tokens</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-xs font-mono">claude-sonnet-4-6</td>
                <td>Clanker Seller</td>
                <td className="text-xs font-mono">$0.16</td>
                <td className="text-xs font-mono">$0.65</td>
              </tr>
              <tr>
                <td className="text-xs font-mono">claude-sonnet-4-6</td>
                <td>Flash</td>
                <td className="text-xs font-mono">$1.00</td>
                <td className="text-xs font-mono">$5.00</td>
              </tr>
              <tr>
                <td className="text-xs font-mono">claude-sonnet-4-6</td>
                <td>Open Ant</td>
                <td className="text-xs font-mono">$3.60</td>
                <td className="text-xs font-mono">$18.00</td>
              </tr>
              <tr className="border-t-2 border-edge">
                <td className="text-xs font-mono">claude-opus-4-6</td>
                <td>Clanker Seller</td>
                <td className="text-xs font-mono">$0.60</td>
                <td className="text-xs font-mono">$1.00</td>
              </tr>
              <tr>
                <td className="text-xs font-mono">claude-opus-4-6</td>
                <td>Flash</td>
                <td className="text-xs font-mono">$5.00</td>
                <td className="text-xs font-mono">$25.00</td>
              </tr>
              <tr>
                <td className="text-xs font-mono">claude-opus-4-6</td>
                <td>Open Ant</td>
                <td className="text-xs font-mono">$7.50</td>
                <td className="text-xs font-mono">$37.50</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Prices drift as providers update their rates. Check the{" "}
          <Link href="/providers" className="text-accent hover:underline">
            provider directory
          </Link>{" "}
          for current pricing. The buyer&rsquo;s router factors price into its
          selection &mdash; cheaper providers rank higher, all else being equal.
        </p>
      </section>

      {/* ── What works / doesn't ────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">What works and what doesn&rsquo;t yet</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="panel p-5 space-y-2">
            <h3 className="text-sm font-medium text-accent">Works</h3>
            <ul className="text-sm text-muted space-y-1.5 leading-relaxed list-disc pl-4">
              <li>Single-turn and multi-turn messages</li>
              <li>Streaming responses</li>
              <li>Both Anthropic and OpenAI API formats</li>
              <li>Automatic provider selection and failover</li>
              <li>Claude Sonnet 4.6, Opus 4.6, Opus 4.7, Haiku 4.5</li>
              <li>Non-Claude models (DeepSeek, GPT-5.x, Gemini, etc.)</li>
            </ul>
          </div>

          <div className="panel p-5 space-y-2">
            <h3 className="text-sm font-medium text-warn">Rough edges</h3>
            <ul className="text-sm text-muted space-y-1.5 leading-relaxed list-disc pl-4">
              <li>
                Tool use (function calling) &mdash; support varies by provider
              </li>
              <li>
                Very long contexts &mdash; some providers cap below 200k tokens
              </li>
              <li>
                Provider quality &mdash; not all providers deliver equal
                latency or reliability; check ghost rates on the{" "}
                <Link
                  href="/providers"
                  className="text-accent hover:underline"
                >
                  directory
                </Link>
              </li>
              <li>
                No usage dashboard yet &mdash; track spend via{" "}
                <code className="font-mono text-xs">antseed buyer balance</code>{" "}
                and on-chain settlement events
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── Other harnesses ─────────────────────────────────── */}
      <section className="panel p-5 space-y-3">
        <h2 className="font-medium">Other harnesses</h2>
        <p className="text-sm text-muted leading-relaxed">
          Any tool that lets you override the API base URL can route through
          AntSeed. The key env vars:
        </p>
        <table className="tbl">
          <thead>
            <tr>
              <th>Harness</th>
              <th>Env var</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-sm">Claude Code</td>
              <td className="text-xs font-mono">ANTHROPIC_BASE_URL</td>
              <td className="text-xs font-mono">http://localhost:8377</td>
            </tr>
            <tr>
              <td className="text-sm">Aider</td>
              <td className="text-xs font-mono">ANTHROPIC_BASE_URL</td>
              <td className="text-xs font-mono">http://localhost:8377</td>
            </tr>
            <tr>
              <td className="text-sm">Cline / Continue</td>
              <td className="text-xs font-mono">OPENAI_BASE_URL</td>
              <td className="text-xs font-mono">http://localhost:8377</td>
            </tr>
            <tr>
              <td className="text-sm">Any OpenAI-compatible</td>
              <td className="text-xs font-mono">OPENAI_BASE_URL</td>
              <td className="text-xs font-mono">http://localhost:8377</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-muted">
          AntStation Desktop runs on port 8378. If using the desktop app, replace
          8377 with 8378.
        </p>
      </section>

      {/* ── CTA ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Get started</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <a
            href="https://github.com/AntSeed/antseed/releases/latest"
            target="_blank"
            rel="noreferrer"
            className="panel p-4 text-center hover:border-accent/40 transition-colors"
          >
            <div className="text-sm font-medium text-ink">Install AntStation</div>
            <div className="text-xs text-muted mt-1">Desktop app for Mac &amp; Windows</div>
          </a>
          <a
            href="https://antseed.com/docs/install"
            target="_blank"
            rel="noreferrer"
            className="panel p-4 text-center hover:border-accent/40 transition-colors"
          >
            <div className="text-sm font-medium text-ink">CLI buyer docs</div>
            <div className="text-xs text-muted mt-1">
              npm install -g @antseed/cli
            </div>
          </a>
          <Link
            href="/providers"
            className="panel p-4 text-center hover:border-accent/40 transition-colors"
          >
            <div className="text-sm font-medium text-ink">Browse providers</div>
            <div className="text-xs text-muted mt-1">
              See who serves what, at what price
            </div>
          </Link>
        </div>
        <p className="text-sm text-muted leading-relaxed">
          Questions, bugs, or rough edges?{" "}
          <a
            className="text-accent hover:underline"
            href="https://github.com/Augustas11/antseed-explorer/issues/new"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open a GitHub issue
          </a>{" "}
          or ping{" "}
          <a
            className="text-accent hover:underline"
            href="https://x.com/AntFeed_"
            target="_blank"
            rel="noreferrer"
          >
            @AntFeed
          </a>{" "}
          on X.
        </p>
      </section>
    </article>
  );
}
