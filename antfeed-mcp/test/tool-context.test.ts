import { describe, expect, it, vi } from "vitest";
import { ExplorerClient } from "../src/explorer.js";
import { toolContext } from "../src/tool-context.js";

const BASE = "https://example.test";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeExplorer(fetchImpl: typeof fetch) {
  return new ExplorerClient({
    baseUrl: BASE,
    timeoutMs: 1000,
    fetchImpl,
    userAgent: "antfeed-mcp/test",
  });
}

function sellersBody() {
  return jsonResponse({ sellers: [], total: 0, limit: 10, offset: 0 });
}

describe("ExplorerClient + toolContext", () => {
  it("appends via=mcp&tool=<name> to outbound URLs inside toolContext.run", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellersBody());
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);

    await toolContext.run({ tool: "list_providers" }, async () => {
      await explorer.listSellers({});
    });

    const url = new URL(fetchImpl.mock.calls[0]![0] as string);
    expect(url.searchParams.get("via")).toBe("mcp");
    expect(url.searchParams.get("tool")).toBe("list_providers");
  });

  it("merges tagging onto URLs that already have query params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellersBody());
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);

    await toolContext.run({ tool: "list_providers" }, async () => {
      await explorer.listSellers({ offset: 5, limit: 10, sort: "volume", dir: "desc" });
    });

    const url = new URL(fetchImpl.mock.calls[0]![0] as string);
    expect(url.searchParams.get("offset")).toBe("5");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("sort")).toBe("volume");
    expect(url.searchParams.get("dir")).toBe("desc");
    expect(url.searchParams.get("via")).toBe("mcp");
    expect(url.searchParams.get("tool")).toBe("list_providers");
  });

  it("does NOT tag URLs when called outside any toolContext.run", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sellersBody());
    const explorer = makeExplorer(fetchImpl as unknown as typeof fetch);

    await explorer.listSellers({});

    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).not.toContain("via=mcp");
    expect(url).not.toContain("tool=");
  });
});
