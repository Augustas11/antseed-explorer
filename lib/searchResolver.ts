import { sql } from "drizzle-orm";
import { db } from "./db";
import {
  isExplorerAddress,
  listServices,
  lookupAddress,
  lookupByProviderName,
} from "./queries";
import { shortAddr } from "./format";

export type SearchMatchType = "buyer" | "seller" | "channel" | "tx" | "service";

export interface SearchMatch {
  type: SearchMatchType;
  label: string;
  detail: string;
  href: string;
  exact: boolean;
}

const HEX_32_RE = /^0x[0-9a-fA-F]{64}$/;

function normalizeQuery(raw: string): string {
  return raw.trim().slice(0, 120);
}

async function channelMatches(q: string): Promise<SearchMatch[]> {
  if (!HEX_32_RE.test(q)) return [];
  const channelId = q.toLowerCase();
  const rows = await db.execute<{ channel_id: string }>(sql`
    SELECT channel_id
    FROM events
    WHERE channel_id = ${channelId}
    LIMIT 1
  `);
  if (rows.rows.length === 0) return [];
  return [
    {
      type: "channel",
      label: `${channelId.slice(0, 10)}…${channelId.slice(-8)}`,
      detail: "Channel id",
      href: `/channels/${channelId}`,
      exact: true,
    },
  ];
}

async function txMatches(q: string): Promise<SearchMatch[]> {
  if (!HEX_32_RE.test(q)) return [];
  const hash = q.toLowerCase();
  const rows = await db.execute<{ tx_hash: string }>(sql`
    SELECT tx_hash
    FROM events
    WHERE tx_hash = ${hash}
    LIMIT 1
  `);
  if (rows.rows.length === 0) return [];
  return [
    {
      type: "tx",
      label: `${hash.slice(0, 10)}…${hash.slice(-8)}`,
      detail: "Transaction",
      href: `/tx/${hash}`,
      exact: true,
    },
  ];
}

async function addressMatches(q: string): Promise<SearchMatch[]> {
  const normalized = q.toLowerCase();
  if (isExplorerAddress(normalized)) {
    const result = await lookupAddress(normalized);
    if (!result) return [];
    return [
      {
        type: result.type,
        label: shortAddr(result.address),
        detail: result.type === "buyer" ? "Buyer address" : "Seller address",
        href: `/${result.type === "buyer" ? "buyers" : "sellers"}/${result.address}`,
        exact: true,
      },
    ];
  }

  if (!/^0x[0-9a-f]{4,40}$/i.test(normalized)) return [];
  const like = `${normalized}%`;
  const [buyers, sellers] = await Promise.all([
    db.execute<{ address: string }>(sql`
      SELECT address
      FROM buyer_profiles
      WHERE address LIKE ${like}
      ORDER BY trust_score DESC
      LIMIT 4
    `),
    db.execute<{ seller_address: string }>(sql`
      SELECT seller_address
      FROM events
      WHERE seller_address LIKE ${like}
        AND seller_address IS NOT NULL
      GROUP BY seller_address
      ORDER BY COUNT(*) DESC
      LIMIT 4
    `),
  ]);

  return [
    ...buyers.rows.map((row): SearchMatch => ({
      type: "buyer",
      label: shortAddr(row.address),
      detail: "Buyer address",
      href: `/buyers/${row.address}`,
      exact: false,
    })),
    ...sellers.rows.map((row): SearchMatch => ({
      type: "seller",
      label: shortAddr(row.seller_address),
      detail: "Seller address",
      href: `/sellers/${row.seller_address}`,
      exact: false,
    })),
  ];
}

async function serviceMatches(q: string, limit: number): Promise<SearchMatch[]> {
  if (q.length < 2 || q.startsWith("0x")) return [];
  const needle = q.toLowerCase();
  const services = await listServices();
  return services
    .filter((service) => {
      const haystack = [service.name, service.display, ...service.aliases]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, limit)
    .map((service): SearchMatch => ({
      type: "service",
      label: service.display,
      detail: `${service.provider_count} seller${service.provider_count === 1 ? "" : "s"}`,
      href: `/services/${encodeURIComponent(service.name)}`,
      exact:
        service.name.toLowerCase() === needle ||
        service.display.toLowerCase() === needle ||
        service.aliases.some((alias) => alias.toLowerCase() === needle),
    }));
}

async function providerNameMatch(q: string): Promise<SearchMatch[]> {
  if (q.length < 2 || q.startsWith("0x")) return [];
  const address = await lookupByProviderName(q);
  if (!address) return [];
  return [
    {
      type: "seller",
      label: q,
      detail: `Seller ${shortAddr(address)}`,
      href: `/sellers/${address}`,
      exact: true,
    },
  ];
}

export async function resolveSearchMatches(
  raw: string,
  limit = 8,
): Promise<SearchMatch[]> {
  const q = normalizeQuery(raw);
  if (!q) return [];
  const normalized = q.toLowerCase();
  const matches = await Promise.all([
    addressMatches(normalized),
    channelMatches(normalized),
    txMatches(normalized),
    providerNameMatch(q),
    serviceMatches(q, limit),
  ]);
  const seen = new Set<string>();
  const flat = matches.flat().filter((match) => {
    const key = `${match.type}:${match.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  flat.sort((a, b) => Number(b.exact) - Number(a.exact));
  return flat.slice(0, Math.max(1, Math.min(20, limit)));
}

export async function resolveSearchDestination(raw: string): Promise<string | null> {
  const matches = await resolveSearchMatches(raw, 8);
  if (matches.length === 1) return matches[0].href;
  const exact = matches.filter((match) => match.exact);
  return exact.length === 1 ? exact[0].href : null;
}
