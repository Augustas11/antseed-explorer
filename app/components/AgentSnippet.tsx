"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export default function AgentSnippet({
  title = "Use this model via your agent",
  peerId,
  service,
  services,
}: {
  title?: string;
  peerId: string | null | undefined;
  service?: string;
  services?: string[];
}) {
  const serviceOptions = services?.filter(Boolean) ?? [];
  const [selectedService, setSelectedService] = useState(
    service ?? serviceOptions[0] ?? "",
  );
  const [copied, setCopied] = useState(false);
  const snippet = useMemo(
    () => `# one-time install
# see antfeed.org/mcp

# in your agent
create_session(providerPeerId="${peerId ?? "..."}", service="${selectedService || "..."}", initialDepositUsdc=1)`,
    [peerId, selectedService],
  );

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <section id="mcp" className="panel p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-medium">{title}</h2>
          <p className="text-xs text-muted mt-1">
            Install MCP once, then ask your agent to open a funded marketplace session.
          </p>
        </div>
        <Link href="/mcp" className="text-xs text-accent hover:underline">
          Install MCP →
        </Link>
      </div>

      {serviceOptions.length > 1 && (
        <label className="block text-xs text-muted">
          Pick a service
          <select
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
            className="mt-1 block w-full max-w-md rounded border border-edge bg-bg px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent/60"
          >
            {serviceOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      )}

      {!peerId && (
        <div className="text-xs text-warn">
          This provider has no indexed peerId yet, so the snippet needs a live provider peerId before use.
        </div>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={copy}
          className="absolute right-2 top-2 rounded border border-edge bg-panel px-2 py-1 text-xs text-muted hover:text-ink"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <pre className="bg-bg border border-edge rounded p-4 pr-20 text-xs font-mono overflow-x-auto leading-relaxed">
          <code>{snippet}</code>
        </pre>
      </div>
    </section>
  );
}
