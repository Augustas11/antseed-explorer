import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { detectBuyer } from "../src/buyer.js";
import { buildTools, READ_ONLY_TOOLS } from "../src/tools/registry.js";

let server: HttpServer | undefined;

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ port: number; url: string }> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server address not available");
  return { port: addr.port, url: `http://127.0.0.1:${addr.port}` };
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
    server = undefined;
  }
});

describe("buyer auto-detect (lenient mode)", () => {
  it("verifies identity when /health returns {service:'antseed-buyer'}", async () => {
    const { url } = await startServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ service: "antseed-buyer", version: "0.1.0" }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    const r = await detectBuyer(url, 500, "lenient");
    expect(r.reachable).toBe(true);
    expect(r.identityVerified).toBe(true);
    expect(r.warning).toBeUndefined();
  });

  it("accepts antstation identity", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ service: "antstation" }));
    });
    const r = await detectBuyer(url, 500, "lenient");
    expect(r.identityVerified).toBe(true);
  });

  it("returns reachable but unverified with warning when /health body lacks identity", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const r = await detectBuyer(url, 500, "lenient");
    expect(r.reachable).toBe(true);
    expect(r.identityVerified).toBe(false);
    expect(r.warning).toBeDefined();
  });

  it("returns reachable but unverified when /health body is non-JSON", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });
    const r = await detectBuyer(url, 500, "lenient");
    expect(r.reachable).toBe(true);
    expect(r.identityVerified).toBe(false);
  });

  it("returns not-reachable when /health responds 500", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    const r = await detectBuyer(url, 500, "lenient");
    expect(r.reachable).toBe(false);
  });

  it("returns not-reachable when buyer is unreachable", async () => {
    const r = await detectBuyer("http://127.0.0.1:1", 200, "lenient");
    expect(r.reachable).toBe(false);
  });

  it("returns not-reachable when /health hangs past timeout", async () => {
    const { url } = await startServer(() => {
      // never respond — AbortController fires
    });
    const t0 = Date.now();
    const r = await detectBuyer(url, 100, "lenient");
    const elapsed = Date.now() - t0;
    expect(r.reachable).toBe(false);
    expect(elapsed).toBeLessThan(1500);
  });
});

describe("buyer auto-detect (strict mode)", () => {
  it("rejects an unidentified buyer", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const r = await detectBuyer(url, 500, "strict");
    expect(r.reachable).toBe(false);
    expect(r.warning).toMatch(/ANTSEED_BUYER_STRICT/);
  });

  it("rejects an impostor identity", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ service: "evil-service" }));
    });
    const r = await detectBuyer(url, 500, "strict");
    expect(r.reachable).toBe(false);
  });

  it("accepts a verified buyer", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ service: "antseed-buyer" }));
    });
    const r = await detectBuyer(url, 500, "strict");
    expect(r.reachable).toBe(true);
    expect(r.identityVerified).toBe(true);
  });
});

describe("tool registry depends on buyer detection", () => {
  it("includes create_session when buyer reachable, omits buyer_setup", async () => {
    const { url } = await startServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ service: "antseed-buyer" }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    const r = await detectBuyer(url, 500, "lenient");
    const tools = buildTools(r.reachable);
    const names = tools.map((t) => t.name);
    expect(names).toContain("create_session");
    expect(names).not.toContain("buyer_setup");
    expect(tools.length).toBe(READ_ONLY_TOOLS.length + 1);
  });

  it("includes buyer_setup when buyer unreachable, omits create_session", async () => {
    const r = await detectBuyer("http://127.0.0.1:1", 200, "lenient");
    const tools = buildTools(r.reachable);
    const names = tools.map((t) => t.name);
    expect(names).toContain("buyer_setup");
    expect(names).not.toContain("create_session");
    expect(tools.length).toBe(READ_ONLY_TOOLS.length + 1);
  });

  it("always exposes the four read-only tools", () => {
    for (const reachable of [true, false]) {
      const names = buildTools(reachable).map((t) => t.name);
      expect(names).toContain("lookup");
      expect(names).toContain("list_providers");
      expect(names).toContain("get_pricing");
      expect(names).toContain("get_session_status");
    }
  });
});
