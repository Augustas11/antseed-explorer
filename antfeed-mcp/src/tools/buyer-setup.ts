export const buyerSetupTool = {
  name: "buyer_setup",
  description:
    "Diagnostic tool exposed when no local AntSeed buyer is detected at startup. Returns instructions for installing the AntSeed CLI buyer or AntStation Desktop, plus the buyer URL the MCP probed. Restart the MCP server after installing a buyer.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
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
    securityNote:
      "For higher security on shared or multi-tenant boxes, set ANTSEED_BUYER_STRICT=1 once your buyer emits {\"service\":\"antseed-buyer\"} on /health. This prevents another local process from impersonating the buyer.",
    nextSteps:
      "1) Install a buyer. 2) Confirm it serves a 200 on GET /health (ideally with a JSON body {service:'antseed-buyer'}). 3) Restart this MCP server. 4) create_session should appear in the tool list.",
  };
}
