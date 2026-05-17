import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SERVER_INSTRUCTIONS } from "../src/index.js";

// Round-trips a Server constructed with `instructions` through an in-memory
// transport pair to a Client, and asserts the agent-facing preamble survives
// the MCP `initialize` exchange. Catches both an empty constant and a
// regression where the Server stops forwarding the option.
describe("server initialize", () => {
  it("advertises `instructions` to the client on connect", async () => {
    const server = new Server(
      { name: "antfeed-mcp-test", version: "0.0.0" },
      { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
    );
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(0);
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    await client.close();
    await server.close();
  });
});
