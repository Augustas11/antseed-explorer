import type { BuyerClient } from "../buyer.js";
import { BuyerError } from "../buyer.js";
import { createSessionSchema } from "../schemas.js";

export const createSessionTool = {
  name: "create_session",
  description:
    "Open a new buyer→seller session on the AntSeed network via the local buyer (POST localhost:8377/sessions). Only registered when a local buyer is detected at startup. The buyer holds the signing key; this tool never sees the private key. NOTE: initialDepositUsdc is hard-capped by the MCP (default 10 USDC, configurable via ANTSEED_MAX_DEPOSIT_USDC) as a defense-in-depth ceiling against prompt-injection-triggered large transfers.",
  inputSchema: {
    type: "object" as const,
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
