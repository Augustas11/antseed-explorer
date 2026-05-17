import type { ExplorerClient } from "../explorer.js";
import type { ToolDef } from "./registry.js";

export const networkStatsTool: ToolDef = {
  name: "network_stats",
  description:
    "Get a one-shot point-in-time snapshot of antfeed: settled revenue, today's DAU, indexer→profile drift, and Base gas price. Use this for 'state of the network right now' questions; use dau_trend for growth over time. Parallel fetches /api/stats, /api/gas, and /api/metrics/dau; any individual upstream failure degrades that field to null and is listed in partialFailures.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      revenueUsdc: { type: ["number", "null"], description: "Total settled USDC across the network. null when /api/stats failed." },
      dau: { type: ["integer", "null"], description: "Daily active users for today's UTC bucket. null when /api/metrics/dau failed or returned no rows." },
      drift: {
        type: ["number", "null"],
        description: "USDC drift between raw events and aggregated profiles. 0 = in sync; null when /api/stats failed.",
      },
      gasGwei: {
        type: ["number", "null"],
        description: "Current Base estimated fee in gwei. null when fee estimation failed or /api/gas was unreachable.",
      },
      asOf: { type: "string", description: "ISO timestamp when the snapshot was assembled" },
      partialFailures: {
        type: "array",
        items: { type: "string", enum: ["stats", "gas", "dau"] },
        description: "List of upstream endpoints that failed for this snapshot. Empty when all three succeeded.",
      },
    },
    required: ["revenueUsdc", "dau", "drift", "gasGwei", "asOf", "partialFailures"],
    additionalProperties: false,
  },
  annotations: {
    title: "Network Stats",
    readOnlyHint: true,
    // Mutates minute-to-minute — repeat calls return different snapshots.
    idempotentHint: false,
    openWorldHint: false,
  },
};

export async function networkStats(_raw: unknown, deps: { explorer: ExplorerClient }) {
  const today = new Date().toISOString().slice(0, 10);
  // allSettled — a one-shot snapshot should report what it can. A single
  // /api/gas hiccup shouldn't blank out revenue and DAU.
  const [statsR, gasR, dauR] = await Promise.allSettled([
    deps.explorer.getNetworkStats(),
    deps.explorer.getGas(),
    deps.explorer.getDauTrend({ from: today, to: today }),
  ]);

  const partialFailures: ("stats" | "gas" | "dau")[] = [];
  let revenueUsdc: number | null = null;
  let drift: number | null = null;
  let gasGwei: number | null = null;
  let dau: number | null = null;

  if (statsR.status === "fulfilled") {
    revenueUsdc = statsR.value.totalVolumeUsdc ?? null;
    drift = statsR.value.drift?.driftUsdc ?? null;
  } else {
    partialFailures.push("stats");
  }

  if (gasR.status === "fulfilled") {
    gasGwei = parseGwei(gasR.value.gwei);
  } else {
    partialFailures.push("gas");
  }

  if (dauR.status === "fulfilled") {
    dau = dauR.value.length > 0 ? dauR.value[dauR.value.length - 1]!.total : null;
  } else {
    partialFailures.push("dau");
  }

  return {
    revenueUsdc,
    dau,
    drift,
    gasGwei,
    asOf: new Date().toISOString(),
    partialFailures,
  };
}

function parseGwei(raw: string | number | null): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}
