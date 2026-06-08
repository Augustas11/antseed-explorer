export function snippetString(value: string): string {
  return JSON.stringify(value);
}

export function buildAgentSessionSnippet({
  peerId,
  service,
}: {
  peerId: string | null | undefined;
  service: string | null | undefined;
}): string {
  return `# one-time install
# see antfeed.org/mcp

# in your agent
create_session(providerPeerId=${snippetString(peerId ?? "...")}, service=${snippetString(service || "...")}, initialDepositUsdc=1)`;
}
