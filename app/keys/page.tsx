"use client";

import { useState } from "react";

export default function KeysPage() {
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setNewKey(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || null }),
      });
      const data = await res.json();
      setNewKey(data.key);
      setLabel("");
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">API Keys</h1>
        <p className="text-muted text-sm mt-1">
          Generate a key to unlock 300 req/min (vs 60 req/min unauthenticated).
          Pass it as the <code className="font-mono text-xs">X-Api-Key</code>{" "}
          header on any{" "}
          <a href="/docs" className="text-accent hover:underline">
            API request
          </a>
          .
        </p>
      </div>

      <section className="panel p-5 space-y-4">
        <h2 className="font-medium">Generate new key</h2>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-0 space-y-1">
            <label className="text-xs text-muted">Label (optional)</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. my-app"
              maxLength={80}
              className="w-full bg-panel border border-edge rounded px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <button
            onClick={generate}
            disabled={loading}
            className="btn shrink-0"
          >
            {loading ? "Generating…" : "Generate key"}
          </button>
        </div>

        {newKey && (
          <div className="rounded border border-edge bg-bg p-4 space-y-2">
            <p className="text-xs text-warn font-medium">
              Save this key — it will not be shown again.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="font-mono text-sm text-ink break-all flex-1">
                {newKey}
              </code>
              <button onClick={copy} className="btn text-xs shrink-0">
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel p-5 space-y-3">
        <h2 className="font-medium">Rate limits</h2>
        <table className="tbl">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Limit</th>
              <th>How to use</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Free (no key)</td>
              <td>60 req/min</td>
              <td className="text-muted text-xs">No setup required</td>
            </tr>
            <tr>
              <td>API key</td>
              <td>300 req/min</td>
              <td>
                <code className="font-mono text-xs">X-Api-Key: &lt;key&gt;</code>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-muted">
          Exceeded limits receive a{" "}
          <code className="font-mono">429 Too Many Requests</code> response with
          a <code className="font-mono">Retry-After</code> header (seconds).
        </p>
      </section>
    </div>
  );
}
