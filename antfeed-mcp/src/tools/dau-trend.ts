import type { ExplorerClient } from "../explorer.js";
import { dauTrendSchema } from "../schemas.js";
import type { ToolDef } from "./registry.js";

export const dauTrendTool: ToolDef = {
  name: "dau_trend",
  description:
    "Get the daily active users series between two dates (UTC days). Use for growth/trend questions; use network_stats for today's single value. Returns per-day total DAU plus buyer/seller breakdown and new-user count. Default window: last 30 days. granularity: day (only value supported today).",
  inputSchema: {
    type: "object",
    properties: {
      from: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        description: "ISO date YYYY-MM-DD (UTC). Default: today − 30 days.",
      },
      to: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        description: "ISO date YYYY-MM-DD (UTC). Default: today.",
      },
      granularity: {
        type: "string",
        enum: ["day"],
        default: "day",
        description: "Bucket size. Only 'day' is supported today; param is reserved for future expansion.",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      granularity: { type: "string", enum: ["day"] },
      series: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            dau: { type: "integer", description: "Distinct active addresses on this day" },
            dauBuyers: { type: "integer" },
            dauSellers: { type: "integer" },
            newUsers: { type: "integer", description: "Buyers whose first lifetime deposit was on this day" },
          },
          required: ["date", "dau", "dauBuyers", "dauSellers", "newUsers"],
        },
      },
    },
    required: ["from", "to", "granularity", "series"],
    additionalProperties: false,
  },
  annotations: {
    title: "DAU Trend",
    readOnlyHint: true,
    // Past days are immutable once closed; today's bucket moves until UTC midnight.
    // Treated as non-idempotent because the window typically includes today.
    idempotentHint: false,
    openWorldHint: false,
  },
};

export async function dauTrend(raw: unknown, deps: { explorer: ExplorerClient }) {
  const input = dauTrendSchema.parse(raw);
  const to = input.to ?? today();
  const from = input.from ?? daysAgo(29, to);

  const rows = await deps.explorer.getDauTrend({ from, to });

  return {
    from,
    to,
    granularity: input.granularity,
    series: rows.map((r) => ({
      date: r.day,
      dau: r.total,
      dauBuyers: r.dau_buyers,
      dauSellers: r.dau_sellers,
      newUsers: r.new,
    })),
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number, fromIso: string): string {
  const d = new Date(`${fromIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
