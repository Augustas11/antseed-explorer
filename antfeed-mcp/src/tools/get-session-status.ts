import type { ChannelRow, ExplorerClient } from "../explorer.js";
import { ExplorerError } from "../explorer.js";
import { getSessionStatusSchema } from "../schemas.js";

export const getSessionStatusTool = {
  name: "get_session_status",
  description:
    "Returns the indexed status of an AntSeed payment-channel session by channel_id. Backed by /api/channels — the explorer does not yet expose a per-channel endpoint, so v1 paginates through channels client-side and filters. v1.1 will switch to /api/channels/{id} once available.",
  inputSchema: {
    type: "object" as const,
    properties: {
      sessionId: { type: "string", description: "Channel ID (bytes32 hex, e.g. 0xabc...)" },
    },
    required: ["sessionId"],
    additionalProperties: false,
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
    service: null,
    status: c.state,
    channelBalance: c.max_amount_usdc,
    settledAmountUsdc: c.settled_amount_usdc,
    totalDeltaUsdc: c.total_delta_usdc,
    messagesDelivered: null,
    eventCount: c.event_count,
    settled,
    lastTxHash: null,
    openedAt: c.opened_ts ? new Date(c.opened_ts * 1000).toISOString() : null,
    closedAt: settled && c.last_ts ? new Date(c.last_ts * 1000).toISOString() : null,
    note: "service / messagesDelivered / lastTxHash are not currently indexed by the explorer.",
  };
}
