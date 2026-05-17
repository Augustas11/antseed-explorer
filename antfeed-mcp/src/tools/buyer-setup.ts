import type { ToolDef } from "./registry.js";

export const buyerSetupTool: ToolDef = {
  name: "buyer_setup",
  description:
    "Diagnose missing local AntSeed buyer — registered instead of create_session when no buyer responded to /health at startup. Use this to tell the user how to install a buyer (CLI or AntStation Desktop). Returns the probed buyer URL and install instructions. For trading, install a buyer and restart the MCP server.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["BUYER_NOT_DETECTED"] },
      probedAt: { type: "string", description: "URL the MCP probed for /health" },
      strictMode: { type: "boolean" },
      message: { type: "string" },
      options: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            defaultPort: { type: "integer" },
            envVar: { type: "string" },
            installHint: { type: "string" },
          },
          required: ["name", "description", "defaultPort", "envVar", "installHint"],
        },
      },
      nextSteps: { type: "string" },
    },
    required: ["status", "probedAt", "strictMode", "message", "options", "nextSteps"],
    additionalProperties: false,
  },
  annotations: {
    title: "Buyer Setup Help",
    readOnlyHint: true,
    openWorldHint: false,
  },
};

export async function buyerSetup(_raw: unknown, deps: { buyerUrl: string; strict?: boolean }) {
  return {
    status: "BUYER_NOT_DETECTED" as const,
    probedAt: deps.buyerUrl,
    strictMode: !!deps.strict,
    message: deps.strict
      ? "No process responded to /health with a recognized AntSeed identity body. ANTSEED_BUYER_STRICT=1 is set, so create_session is being withheld for safety. Either start a buyer that emits {\"service\":\"antseed-buyer\"} on /health, or unset ANTSEED_BUYER_STRICT to fall back to lenient detection."
      : "No local AntSeed buyer responded to /health at startup. create_session is not registered. Install one of the buyers below, then restart this MCP server.",
    options: [
      {
        name: "AntSeed CLI buyer",
        description: "Headless buyer daemon for terminals and CI.",
        defaultPort: 8377,
        envVar: "ANTSEED_BUYER_URL",
        installHint: "See https://antfeed.org for the AntSeed CLI installer.",
      },
      {
        name: "AntStation Desktop",
        description: "Mac/Windows app with a built-in buyer.",
        defaultPort: 8378,
        envVar: "ANTSEED_BUYER_URL",
        installHint:
          "Set ANTSEED_BUYER_URL=http://localhost:8378 in your MCP config if you use AntStation instead of the CLI buyer.",
      },
    ],
    nextSteps:
      "1) Install a buyer. 2) Confirm it serves a 200 on GET /health (ideally with a JSON body {service:'antseed-buyer'}). 3) Restart this MCP server. 4) create_session should appear in the tool list.",
  };
}
