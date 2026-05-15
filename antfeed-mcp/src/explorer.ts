import { BuyersPageZ, ChannelsPageZ, SellersPageZ } from "./schemas.js";
import { readJsonCapped } from "./http.js";

export class ExplorerError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ExplorerError";
  }
}

export interface ExplorerConfig {
  baseUrl: string;
  timeoutMs: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
}

export interface SellerRow {
  address: string;
  unique_buyers: number;
  total_sessions: number;
  total_earned_usdc: number;
  ghost_sessions: number;
  first_seen_ts: number | null;
  last_seen_ts: number | null;
  first_seen_block: number | null;
  last_seen_block: number | null;
}

export interface BuyerRow {
  address: string;
  total_sessions: number;
  total_settled_usdc: number;
  unique_sellers: number;
  ghost_sessions: number;
  first_seen_block: number | null;
  last_seen_block: number | null;
  first_seen_ts: number | null;
  last_seen_ts: number | null;
  trust_score: number;
  qualified: 0 | 1;
}

export interface ChannelRow {
  channel_id: string;
  buyer_address: string | null;
  seller_address: string | null;
  state: string;
  opened_block: number | null;
  last_block: number | null;
  opened_ts: number | null;
  last_ts: number | null;
  max_amount_usdc: number | null;
  settled_amount_usdc: number | null;
  total_delta_usdc: number | null;
  event_count: number;
}

export type SellersPage = { sellers: SellerRow[]; total: number; limit: number; offset: number };
export type BuyersPage = { buyers: BuyerRow[]; total: number; limit: number; offset: number };
export type ChannelsPage = { channels: ChannelRow[]; total: number; limit: number; offset: number };

type SellerSort = "volume" | "sessions" | "buyers" | "ghosts" | "first_seen";
type ChannelSort = "amount" | "settled" | "events" | "opened" | "last_activity";
type Direction = "asc" | "desc";

const DEFAULT_MAX_BYTES = 2_000_000;

export class ExplorerClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: ExplorerConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = cfg.timeoutMs;
    this.maxBytes = cfg.maxBytes ?? DEFAULT_MAX_BYTES;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private buildUrl(path: string, params: Record<string, string | number | undefined>): string {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) usp.set(k, String(v));
    }
    const qs = usp.toString();
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e?.name === "AbortError") {
        throw new ExplorerError("EXPLORER_DOWN", `Timed out after ${this.timeoutMs}ms calling ${pathOf(url)}`);
      }
      throw new ExplorerError("EXPLORER_DOWN", `Network error calling ${pathOf(url)}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      if (res.status === 429) {
        throw new ExplorerError("RATE_LIMITED", `Explorer rate limit hit on ${pathOf(url)}`);
      }
      throw new ExplorerError(`EXPLORER_HTTP_${res.status}`, `Explorer returned ${res.status} on ${pathOf(url)}`);
    }

    try {
      return await readJsonCapped(res, this.maxBytes);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e?.code === "RESPONSE_TOO_LARGE") {
        throw new ExplorerError(
          "EXPLORER_TOO_LARGE",
          `Explorer response exceeded ${this.maxBytes}B on ${pathOf(url)}`,
        );
      }
      throw new ExplorerError("EXPLORER_INVALID_JSON", `Malformed JSON from ${pathOf(url)}`);
    }
  }

  async listSellers(params: { offset?: number; limit?: number; sort?: SellerSort; dir?: Direction } = {}): Promise<SellersPage> {
    const url = this.buildUrl("/api/sellers", {
      offset: params.offset,
      limit: params.limit,
      sort: params.sort,
      dir: params.dir,
    });
    const raw = await this.fetchJson(url);
    const parsed = SellersPageZ.safeParse(raw);
    if (!parsed.success) throw new ExplorerError("EXPLORER_BAD_RESPONSE", "Explorer /api/sellers response did not match expected shape");
    return parsed.data as SellersPage;
  }

  async listBuyers(params: { offset?: number; limit?: number; sort?: string } = {}): Promise<BuyersPage> {
    const url = this.buildUrl("/api/buyers", {
      offset: params.offset,
      limit: params.limit,
      sort: params.sort,
    });
    const raw = await this.fetchJson(url);
    const parsed = BuyersPageZ.safeParse(raw);
    if (!parsed.success) throw new ExplorerError("EXPLORER_BAD_RESPONSE", "Explorer /api/buyers response did not match expected shape");
    return parsed.data as BuyersPage;
  }

  async listChannels(params: { offset?: number; limit?: number; sort?: ChannelSort; dir?: Direction } = {}): Promise<ChannelsPage> {
    const url = this.buildUrl("/api/channels", {
      offset: params.offset,
      limit: params.limit,
      sort: params.sort,
      dir: params.dir,
    });
    const raw = await this.fetchJson(url);
    const parsed = ChannelsPageZ.safeParse(raw);
    if (!parsed.success) throw new ExplorerError("EXPLORER_BAD_RESPONSE", "Explorer /api/channels response did not match expected shape");
    return parsed.data as ChannelsPage;
  }
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || "");
  } catch {
    return url;
  }
}
