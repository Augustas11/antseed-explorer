import type { BuyerClient } from "../buyer.js";
import { BuyerError } from "../buyer.js";
import { createSessionSchema } from "../schemas.js";
import type { ToolDef } from "./registry.js";

export const createSessionTool: ToolDef = {
  name: "create_session",
  description:
    "Open a buyer→seller session — mutating, on-chain action via the local buyer. Use after get_pricing has confirmed cost; not for browsing. Returns {sessionId, status, channelAddress?, txHash?}. initialDepositUsdc is capped by ANTSEED_MAX_DEPOSIT_USDC (default 10 USDC) as a defense-in-depth ceiling against prompt-injected large transfers.",
  inputSchema: {
    type: "object",
    properties: {
      providerPeerId: {
        type: "string",
        description: "Seller's on-chain address (0x-prefixed 40-hex-char Ethereum address)",
        pattern: "^0x[0-9a-fA-F]{40}$",
      },
      service: {
        type: "string",
        description: "Service identifier (e.g. 'code-auditor')",
        minLength: 1,
        maxLength: 64,
      },
      initialDepositUsdc: {
        type: "number",
        exclusiveMinimum: 0,
        description: "Initial channel deposit in USDC. Capped by ANTSEED_MAX_DEPOSIT_USDC.",
      },
      initialMessage: {
        type: "string",
        maxLength: 4000,
        description: "Optional first message to send to the seller after channel open",
      },
    },
    required: ["providerPeerId", "service", "initialDepositUsdc"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Buyer-assigned session id" },
      status: { type: "string", description: "Initial session status (e.g. 'Open')" },
      channelAddress: {
        type: "string",
        pattern: "^0x[0-9a-fA-F]{40}$",
        description: "On-chain channel contract address",
      },
      txHash: {
        type: "string",
        pattern: "^0x[0-9a-fA-F]{1,128}$",
        description: "Open-channel transaction hash",
      },
    },
    // Buyer responses are upstream-passthrough — additional fields (e.g.
    // negotiated price) flow through without breaking the schema contract.
    additionalProperties: true,
  },
  annotations: {
    title: "Open Session",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

export async function createSession(
  raw: unknown,
  deps: { buyer: BuyerClient; maxDepositUsdc: number },
): Promise<unknown> {
  const input = createSessionSchema.parse(raw);
  if (input.initialDepositUsdc > deps.maxDepositUsdc) {
    throw new BuyerError(
      "DEPOSIT_CAP_EXCEEDED",
      `initialDepositUsdc=${input.initialDepositUsdc} exceeds the configured per-call cap of ${deps.maxDepositUsdc} USDC. Raise ANTSEED_MAX_DEPOSIT_USDC if this is intentional.`,
    );
  }
  return deps.buyer.createSession(input);
}
