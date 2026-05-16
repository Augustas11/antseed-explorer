import { readJsonCapped } from "./http.js";
import { BuyerCreateSessionResponseZ, BuyerHealthZ } from "./schemas.js";

export class BuyerError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "BuyerError";
  }
}

export interface BuyerConfig {
  baseUrl: string;
  timeoutMs: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

const DEFAULT_MAX_BYTES = 256_000;

export type BuyerDetectMode = "strict" | "lenient";

export interface BuyerDetectResult {
  reachable: boolean;
  identityVerified: boolean;
  warning?: string;
}

const ACCEPTED_IDENTITIES = ["antseed-buyer", "antstation", "antstation-desktop"];

export async function detectBuyer(
  baseUrl: string,
  timeoutMs = 500,
  mode: BuyerDetectMode = "lenient",
  fetchImpl: typeof fetch = fetch,
  userAgent = "antfeed-mcp",
): Promise<BuyerDetectResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": userAgent },
    });
    if (!res.ok) return { reachable: false, identityVerified: false };

    let body: unknown = null;
    try {
      body = await readJsonCapped(res, 16_000);
    } catch {
      // non-JSON body
    }
    const parsed = body != null ? BuyerHealthZ.safeParse(body) : { success: false as const };
    const identity =
      parsed.success && typeof parsed.data.service === "string" ? parsed.data.service.toLowerCase() : null;
    const verified = identity != null && ACCEPTED_IDENTITIES.includes(identity);

    if (verified) return { reachable: true, identityVerified: true };

    if (mode === "strict") {
      return {
        reachable: false,
        identityVerified: false,
        warning:
          "Local process on the buyer port did not return a recognized identity body. ANTSEED_BUYER_STRICT=1 is set, so create_session is being withheld for safety. Set ANTSEED_BUYER_STRICT=0 to accept any /health 200, or have the buyer respond with {\"service\":\"antseed-buyer\"}.",
      };
    }

    return {
      reachable: true,
      identityVerified: false,
      warning:
        "Local buyer answered /health but did not return a recognized identity body ({service:'antseed-buyer'} or 'antstation'). Accepting in lenient mode. For higher security on shared/multi-tenant boxes, set ANTSEED_BUYER_STRICT=1 once your buyer emits the identity body.",
    };
  } catch {
    return { reachable: false, identityVerified: false };
  } finally {
    clearTimeout(timer);
  }
}

export interface CreateSessionRequest {
  providerPeerId: string;
  service: string;
  initialDepositUsdc: number;
  initialMessage?: string;
}

export class BuyerClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(cfg: BuyerConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = cfg.timeoutMs;
    this.maxBytes = cfg.maxBytes ?? DEFAULT_MAX_BYTES;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.userAgent = cfg.userAgent ?? "antfeed-mcp";
  }

  async createSession(input: CreateSessionRequest): Promise<unknown> {
    const url = `${this.baseUrl}/sessions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": this.userAgent,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e?.name === "AbortError") {
        throw new BuyerError("BUYER_DOWN", `Timed out after ${this.timeoutMs}ms calling local buyer`);
      }
      throw new BuyerError("BUYER_DOWN", "Network error calling local buyer");
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new BuyerError(
        `BUYER_HTTP_${res.status}`,
        `Local buyer returned ${res.status}. Check the buyer's logs for the error body.`,
      );
    }

    let raw: unknown;
    try {
      raw = await readJsonCapped(res, this.maxBytes);
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === "RESPONSE_TOO_LARGE") {
        throw new BuyerError("BUYER_TOO_LARGE", `Buyer response exceeded ${this.maxBytes}B`);
      }
      throw new BuyerError("BUYER_INVALID_JSON", "Malformed JSON from local buyer");
    }

    const parsed = BuyerCreateSessionResponseZ.safeParse(raw);
    if (!parsed.success) {
      throw new BuyerError(
        "BUYER_BAD_RESPONSE",
        "Buyer response did not match the expected create_session shape",
      );
    }
    return parsed.data;
  }
}
