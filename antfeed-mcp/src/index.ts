#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { BuyerClient, BuyerError, detectBuyer } from "./buyer.js";
import { ExplorerClient, ExplorerError } from "./explorer.js";
import { buyerSetup } from "./tools/buyer-setup.js";
import { createSession } from "./tools/create-session.js";
import { getPricing } from "./tools/get-pricing.js";
import { getSessionStatus } from "./tools/get-session-status.js";
import { listProviders } from "./tools/list-providers.js";
import { lookup } from "./tools/lookup.js";
import { buildTools } from "./tools/registry.js";
import { sanitizeMessage } from "./sanitize.js";

const PACKAGE_NAME = "antfeed-mcp";
const PACKAGE_VERSION = "0.1.2";
const USER_AGENT = `${PACKAGE_NAME}/${PACKAGE_VERSION}`;
const MIN_NODE_MAJOR = 20;

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const DEFAULT_MAX_DEPOSIT_USDC = 10;
const HARD_MAX_DEPOSIT_USDC = 10_000;

interface RuntimeConfig {
  explorerUrl: string;
  buyerUrl: string;
  timeoutMs: number;
  logLevel: LogLevel;
  buyerStrict: boolean;
  maxDepositUsdc: number;
}

function isLogLevel(s: string): s is LogLevel {
  return s in LOG_LEVELS;
}

function readConfig(): RuntimeConfig {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--config");
  let fileConfig: Record<string, unknown> = {};
  if (idx >= 0 && argv[idx + 1]) {
    const p = argv[idx + 1]!;
    try {
      const parsed = JSON.parse(readFileSync(resolve(p), "utf8"));
      if (parsed && typeof parsed === "object") {
        // Defensive: prevent any future shallow-spread from being prototype-poisoned via a hostile config file.
        const obj = parsed as Record<string, unknown>;
        for (const k of ["__proto__", "constructor", "prototype"]) {
          delete obj[k];
        }
        fileConfig = obj;
      }
    } catch (err) {
      process.stderr.write(
        `[${PACKAGE_NAME}] warn: failed to load --config ${basename(p)}: ${sanitizeMessage((err as Error).message)}\n`,
      );
    }
  }

  const explorerUrl = validateHttpUrl(
    asString(fileConfig.explorerUrl) ?? process.env.ANTFEED_EXPLORER_URL ?? "https://antfeed.org",
    "ANTFEED_EXPLORER_URL",
  );
  const buyerUrl = validateHttpUrl(
    asString(fileConfig.buyerUrl) ?? process.env.ANTSEED_BUYER_URL ?? "http://localhost:8377",
    "ANTSEED_BUYER_URL",
  );
  const rawTimeout = Number(asString(fileConfig.timeoutMs) ?? process.env.ANTFEED_MCP_TIMEOUT_MS ?? 8000);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0
    ? Math.min(60_000, Math.max(100, Math.floor(rawTimeout)))
    : 8000;
  const rawLevel = asString(fileConfig.logLevel) ?? process.env.ANTFEED_MCP_LOG_LEVEL ?? "info";
  const logLevel: LogLevel = isLogLevel(rawLevel) ? rawLevel : "info";

  const buyerStrict = isTruthyEnv(process.env.ANTSEED_BUYER_STRICT) || fileConfig.buyerStrict === true;

  const rawDeposit = Number(
    asString(fileConfig.maxDepositUsdc) ?? process.env.ANTSEED_MAX_DEPOSIT_USDC ?? DEFAULT_MAX_DEPOSIT_USDC,
  );
  const maxDepositUsdc = Number.isFinite(rawDeposit) && rawDeposit > 0
    ? Math.min(HARD_MAX_DEPOSIT_USDC, rawDeposit)
    : DEFAULT_MAX_DEPOSIT_USDC;

  return { explorerUrl, buyerUrl, timeoutMs, logLevel, buyerStrict, maxDepositUsdc };
}

function isTruthyEnv(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function validateHttpUrl(raw: string, fieldName: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Invalid URL for ${fieldName}: not a parseable URL`);
  }
  const host = u.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (u.protocol === "http:") {
    if (!isLoopback) {
      throw new Error(
        `${fieldName} must use https:// for non-loopback hosts (got http://${host}). ` +
          `Plain http is only permitted for localhost/127.0.0.1.`,
      );
    }
  } else if (u.protocol !== "https:") {
    throw new Error(`Invalid URL for ${fieldName}: protocol must be http or https`);
  }
  return u.toString().replace(/\/+$/, "");
}

function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  return String(v);
}

function makeLogger(level: LogLevel) {
  const threshold = LOG_LEVELS[level];
  return (lvl: LogLevel, msg: string) => {
    if (LOG_LEVELS[lvl] < threshold) return;
    process.stderr.write(`[${PACKAGE_NAME}] ${lvl}: ${msg}\n`);
  };
}

function assertNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    process.stderr.write(
      `[${PACKAGE_NAME}] fatal: Node ${process.versions.node} is unsupported; requires >=${MIN_NODE_MAJOR}\n`,
    );
    process.exit(2);
  }
}

async function main() {
  assertNodeVersion();
  const cfg = readConfig();
  const log = makeLogger(cfg.logLevel);
  log(
    "info",
    `starting v${PACKAGE_VERSION} explorer=${cfg.explorerUrl} buyer=${cfg.buyerUrl} timeoutMs=${cfg.timeoutMs} strict=${cfg.buyerStrict} maxDeposit=${cfg.maxDepositUsdc}USDC`,
  );

  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
    log(
      "warn",
      "HTTP_PROXY/HTTPS_PROXY is set in the environment — outbound traffic may be routed through a proxy. Verify your MCP host launched this process with the expected env.",
    );
  }

  const explorer = new ExplorerClient({
    baseUrl: cfg.explorerUrl,
    timeoutMs: cfg.timeoutMs,
    userAgent: USER_AGENT,
  });
  const buyer = new BuyerClient({
    baseUrl: cfg.buyerUrl,
    timeoutMs: cfg.timeoutMs,
    userAgent: USER_AGENT,
  });

  // Two-attempt detection covers the startup-race case where the buyer
  // comes up shortly after the MCP host launches.
  const mode = cfg.buyerStrict ? "strict" : "lenient";
  let detect = await detectBuyer(cfg.buyerUrl, 500, mode, fetch, USER_AGENT);
  if (!detect.reachable && !cfg.buyerStrict) {
    await new Promise((r) => setTimeout(r, 500));
    detect = await detectBuyer(cfg.buyerUrl, 1000, mode, fetch, USER_AGENT);
  }
  log(
    "info",
    `buyer ${detect.reachable ? "reachable" : "not reachable"}; identityVerified=${detect.identityVerified}`,
  );
  if (detect.warning) log("warn", detect.warning);

  const tools = buildTools(detect.reachable);

  const server = new Server(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as unknown;
    log("debug", `tool call: ${name}`);
    try {
      let result: unknown;
      switch (name) {
        case "lookup":
          result = await lookup(args, { explorer });
          break;
        case "list_providers":
          result = await listProviders(args, { explorer });
          break;
        case "get_pricing":
          result = await getPricing(args, { explorer });
          break;
        case "get_session_status":
          result = await getSessionStatus(args, { explorer });
          break;
        case "create_session":
          if (!detect.reachable) {
            return errorResponse(
              "BUYER_DOWN",
              "Local buyer was not detected at MCP startup. Restart the MCP server with a running buyer.",
            );
          }
          result = await createSession(args, { buyer, maxDepositUsdc: cfg.maxDepositUsdc });
          break;
        case "buyer_setup":
          result = await buyerSetup(args, { buyerUrl: cfg.buyerUrl, strict: cfg.buyerStrict });
          break;
        default:
          return errorResponse("INVALID_INPUT", `Unknown tool: ${name}`);
      }
      return successResponse(result);
    } catch (err) {
      return errorFor(err, log);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "connected via stdio");
}

function successResponse(result: unknown) {
  const text = JSON.stringify(result, null, 2);
  const structured: Record<string, unknown> =
    typeof result === "object" && result !== null && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : { value: result };
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: structured,
  };
}

function errorResponse(code: string, message: string) {
  const payload = { error: { code, message: sanitizeMessage(message) } };
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as unknown as Record<string, unknown>,
  };
}

function errorFor(err: unknown, log: (lvl: LogLevel, msg: string) => void) {
  if (err instanceof z.ZodError) {
    const message = err.issues
      .map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`)
      .join("; ");
    return errorResponse("INVALID_INPUT", message);
  }
  if (err instanceof ExplorerError) return errorResponse(err.code, err.message);
  if (err instanceof BuyerError) return errorResponse(err.code, err.message);
  const raw = err instanceof Error ? err.message : String(err);
  log("error", `unhandled: ${sanitizeMessage(raw)}`);
  return errorResponse("INTERNAL", raw || "Unknown error");
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    // realpathSync resolves the bin symlink (e.g. node_modules/.bin/antfeed-mcp)
    // to match import.meta.url, which Node always reports as the real file path.
    const entryUrl = pathToFileURL(realpathSync(entry)).href;
    return import.meta.url === entryUrl;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err) => {
    const msg = (err as Error).message ?? String(err);
    process.stderr.write(`[${PACKAGE_NAME}] fatal: ${sanitizeMessage(msg)}\n`);
    process.exit(1);
  });
}

export { main, sanitizeMessage };
