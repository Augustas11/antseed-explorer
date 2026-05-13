"use client";

import { useState } from "react";

const USDC_DECIMALS = 1_000_000;
const STATE_LABELS: Record<string, string> = {
  "0": "Pending",
  "1": "Active",
  "2": "Closed",
  "3": "Disputed",
};

interface FnResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

function ResultView({ result }: { result: unknown }) {
  if (result === null || result === undefined) {
    return <span className="text-muted text-sm">null</span>;
  }
  if (Array.isArray(result)) {
    return (
      <div className="space-y-1">
        {result.map((v, i) => (
          <div key={i} className="text-sm font-mono text-ink">{String(v)}</div>
        ))}
      </div>
    );
  }
  if (typeof result === "object") {
    return (
      <div className="space-y-1">
        {Object.entries(result as object).map(([k, v]) => (
          <div key={k} className="flex gap-2 text-sm">
            <span className="text-muted w-28 shrink-0">{k}</span>
            <span className="font-mono text-ink">{String(v)}</span>
          </div>
        ))}
      </div>
    );
  }
  return <span className="font-mono text-sm text-ink">{String(result)}</span>;
}

function FnPanel({
  title,
  description,
  fields,
  fnName,
  buildArgs,
  formatResult,
}: {
  title: string;
  description: string;
  fields: { name: string; label: string; placeholder: string }[];
  fnName: string;
  buildArgs: (values: Record<string, string>) => unknown[];
  formatResult?: (result: unknown) => string;
}) {
  const initial = Object.fromEntries(fields.map((f) => [f.name, ""]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<FnResult | null>(null);

  async function call() {
    const args = buildArgs(values);
    setLoading(true);
    setRes(null);
    try {
      const r = await fetch("/api/read-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fnName, args }),
      });
      setRes(await r.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-edge rounded-lg p-4 space-y-3">
      <div>
        <code className="font-mono text-sm text-accent">{title}</code>
        <p className="text-xs text-muted mt-0.5">{description}</p>
      </div>
      <div className="space-y-2">
        {fields.map((f) => (
          <div key={f.name}>
            <label className="text-xs text-muted">{f.label}</label>
            <input
              type="text"
              value={values[f.name]}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              placeholder={f.placeholder}
              className="mt-0.5 w-full bg-panel border border-edge rounded px-3 py-1.5 text-sm font-mono text-ink placeholder:text-muted focus:outline-none focus:border-accent"
            />
          </div>
        ))}
      </div>
      <button onClick={call} disabled={loading} className="btn text-xs">
        {loading ? "Querying…" : "Query"}
      </button>
      {res && (
        <div className="mt-2 rounded border border-edge bg-bg p-3 space-y-1">
          {res.ok ? (
            formatResult ? (
              <p className="text-sm text-ink">{formatResult(res.result)}</p>
            ) : (
              <ResultView result={res.result} />
            )
          ) : (
            <p className="text-sm text-red-400">{res.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReadContractPanel() {
  return (
    <div className="space-y-4">
      <FnPanel
        title="getChannel(channelId)"
        description="Look up a channel by its bytes32 ID to see buyer, seller, amounts, and state."
        fields={[
          {
            name: "channelId",
            label: "Channel ID (bytes32)",
            placeholder: "0x1234…abcd",
          },
        ]}
        fnName="getChannel"
        buildArgs={(v) => [v.channelId as `0x${string}`]}
        formatResult={(result) => {
          if (!result || typeof result !== "object") return String(result);
          const r = result as Record<string, string>;
          const settled = r[4] ? (Number(r[4]) / USDC_DECIMALS).toFixed(2) : "?";
          const max = r[2] ? (Number(r[2]) / USDC_DECIMALS).toFixed(2) : "?";
          const state = STATE_LABELS[r[5]] ?? r[5];
          return `Buyer: ${r[0]} · Seller: ${r[1]} · Max: $${max} · Settled: $${settled} · State: ${state}`;
        }}
      />

      <FnPanel
        title="balanceOf(address)"
        description="Returns the USDC balance deposited by an address in the AntSeed Channels contract."
        fields={[
          {
            name: "address",
            label: "Address",
            placeholder: "0xabc…",
          },
        ]}
        fnName="balanceOf"
        buildArgs={(v) => [v.address as `0x${string}`]}
        formatResult={(result) => {
          if (result === null || result === undefined) return "0 USDC";
          const raw = typeof result === "string" ? result : String(result);
          const usdc = Number(raw) / USDC_DECIMALS;
          return `${usdc.toFixed(6)} USDC`;
        }}
      />
    </div>
  );
}
