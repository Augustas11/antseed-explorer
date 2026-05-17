import type { ChannelRow, ExplorerClient } from "../explorer.js";
import { ExplorerError } from "../explorer.js";
import { getSessionStatusSchema } from "../schemas.js";
import type { ToolDef } from "./registry.js";

export const getSessionStatusTool: ToolDef = {
  name: "get_session_status",
  description:
    "Look up the on-chain status of one payment channel by channel_id. Use for 'is my session settled yet?' checks; use create_session to open one. Returns {sessionId, buyer, seller, status, channelBalance, settledAmountUsdc, settled, openedAt, closedAt}. v1 paginates /api/channels client-side because there is no per-channel endpoint yet.",
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Channel ID (bytes32 hex, e.g. 0xabc...)" },
    },
    required: ["sessionId"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", pattern: "^0x[0-9a-fA-F]{1,128}$" },
      buyer: { type: ["string", "null"], pattern: "^0x[0-9a-fA-F]{40}$" },
      seller: { type: ["string", "null"], pattern: "^0x[0-9a-fA-F]{40}$" },
      status: { type: "string", description: "Channel state (e.g. 'Open', 'Settled')" },
      channelBalance: { type: ["number", "null"], description: "Max deposit, USDC" },
      settledAmountUsdc: { type: ["number", "null"] },
      totalDeltaUsdc: { type: ["number", "null"] },
      eventCount: { type: "integer" },
      settled: { type: "boolean" },
      openedAt: { type: ["string", "null"], description: "ISO timestamp" },
      closedAt: { type: ["string", "null"], description: "ISO timestamp; only when settled" },
    },
    required: [
      "sessionId",
      "buyer",
      "seller",
      "status",
      "channelBalance",
      "settledAmountUsdc",
      "totalDeltaUsdc",
      "eventCount",
      "settled",
      "openedAt",
      "closedAt",
    ],
    additionalProperties: false,
  },
  annotations: {
    title: "Get Session Status",
    readOnlyHint: true,
    // Status mutates as the channel progresses — not idempotent over time.
    idempotentHint: false,
    openWorldHint: false,
  },
};

const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

export async function getSessionStatus(raw: unknown, deps: { explorer: ExplorerClient }) {
  const input = getSessionStatusSchema.parse(raw);
  const target = input.sessionId.toLowerCase();

  let lastTotal = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await deps.explorer.listChannels({
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
      sort: "last_activity",
      dir: "desc",
    });
    lastTotal = result.total;
    const hit = result.channels.find((c) => c.channel_id.toLowerCase() === target);
    if (hit) return formatSession(hit);
    if (result.channels.length < PAGE_SIZE) {
      throw new ExplorerError(
        "SESSION_NOT_FOUND",
        `No channel with id ${input.sessionId} found in the explorer's index. The id may be incorrect or the channel may not yet be indexed.`,
      );
    }
    if ((page + 1) * PAGE_SIZE >= result.total) {
      throw new ExplorerError(
        "SESSION_NOT_FOUND",
        `No channel with id ${input.sessionId} found in the explorer's index. The id may be incorrect or the channel may not yet be indexed.`,
      );
    }
  }

  throw new ExplorerError(
    "SESSION_OUT_OF_RANGE",
    `Searched ${MAX_PAGES * PAGE_SIZE} most-recent channels (explorer total: ${lastTotal}) but did not find ${input.sessionId}. The channel may exist deeper in history — a per-channel endpoint is planned for v1.1.`,
  );
}

function formatSession(c: ChannelRow) {
  const settled = c.state === "Settled" || (c.settled_amount_usdc != null && c.settled_amount_usdc > 0);
  return {
    sessionId: c.channel_id,
    buyer: c.buyer_address,
    seller: c.seller_address,
    status: c.state,
    channelBalance: c.max_amount_usdc,
    settledAmountUsdc: c.settled_amount_usdc,
    totalDeltaUsdc: c.total_delta_usdc,
    eventCount: c.event_count,
    settled,
    openedAt: c.opened_ts ? new Date(c.opened_ts * 1000).toISOString() : null,
    closedAt: settled && c.last_ts ? new Date(c.last_ts * 1000).toISOString() : null,
  };
}
