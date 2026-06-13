// Reverse-lookup for the bytes32 serviceId hashes embedded in
// SettlementService snapshots. Populated by refreshProviderDirectory()
// (lib/indexer.ts) and seeded by scripts/backfill-service-id-aliases.ts.
//
// 5-minute TTL matches the rest of the hot-page aggregate cache so we don't
// hit the DB on every /models render.

import { db } from "./db";
import { sql } from "drizzle-orm";
import { createTtlCache } from "./ttlCache";

export interface ServiceIdEntry {
  serviceId: string;
  canonicalKey: string;
  display: string;
  rawAlias: string;
}

const SERVICE_ID_CACHE_TTL_MS = 5 * 60_000;

async function loadServiceIdIndex(): Promise<Map<string, ServiceIdEntry>> {
  const rows = await db.execute<{
    service_id: string;
    raw_alias: string;
    canonical_key: string;
    display: string;
  }>(sql`
    SELECT service_id, raw_alias, canonical_key, display
      FROM service_id_aliases
  `);
  const map = new Map<string, ServiceIdEntry>();
  for (const r of rows.rows) {
    map.set(r.service_id, {
      serviceId: r.service_id,
      rawAlias: r.raw_alias,
      canonicalKey: r.canonical_key,
      display: r.display,
    });
  }
  return map;
}

export const getServiceIdIndex = createTtlCache(
  loadServiceIdIndex,
  SERVICE_ID_CACHE_TTL_MS,
).get;
