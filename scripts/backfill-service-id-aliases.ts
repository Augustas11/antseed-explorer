// SPEC §6.3 — bootstrap the service_id_aliases reverse map.
//
// Walks every advertised service string in provider_directory.services and
// upserts a (service_id, canonical_key, display) row. Then walks the set of
// unmapped service_ids that appear in settlement_service_snapshots and warns
// with the top-N by USDC spend, so we can manually enrich the dictionary on
// day 1 for any seller that hashed under a string not in the live directory.
//
// Usage:
//   DATABASE_URL=… npx tsx scripts/backfill-service-id-aliases.ts [--top N]

import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../lib/db";
import { canonicalize } from "../lib/services-canonical";
import { serviceIdOf } from "../lib/metadata";

type DirectoryRow = { services: string | null } & Record<string, unknown>;
type UnmappedRow = {
  service_id: string;
  amount_usdc: number;
  channels: number;
} & Record<string, unknown>;

const TOP_DEFAULT = 25;

function parseTop(argv: string[]): number {
  const i = argv.indexOf("--top");
  if (i < 0) return TOP_DEFAULT;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : TOP_DEFAULT;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const top = parseTop(process.argv.slice(2));
  const now = Date.now();

  console.log("[backfill-aliases] reading provider_directory.services …");
  const dir = await db.execute<DirectoryRow>(sql`
    SELECT services FROM provider_directory WHERE services IS NOT NULL
  `);

  const seen = new Set<string>();
  let upserted = 0;
  for (const row of dir.rows) {
    if (!row.services) continue;
    let arr: unknown;
    try {
      arr = JSON.parse(row.services);
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      const canon = canonicalize(trimmed);
      const id = serviceIdOf(trimmed);
      await db.execute(sql`
        INSERT INTO service_id_aliases
          (service_id, raw_alias, canonical_key, display, first_seen_ts, last_seen_ts)
        VALUES (${id}, ${trimmed}, ${canon.key}, ${canon.display}, ${now}, ${now})
        ON CONFLICT (service_id) DO UPDATE
          SET last_seen_ts = EXCLUDED.last_seen_ts
      `);
      upserted += 1;
    }
  }
  console.log(`[backfill-aliases] upserted ${upserted} alias rows`);

  console.log("[backfill-aliases] scanning settlement_service_snapshots for unmapped service_ids …");
  const unmapped = await db.execute<UnmappedRow>(sql`
    SELECT sss.service_id,
           SUM(sss.cumulative_amount_usdc)::float AS amount_usdc,
           COUNT(DISTINCT sss.channel_id)::int    AS channels
      FROM settlement_service_snapshots sss
      LEFT JOIN service_id_aliases sia USING (service_id)
     WHERE sia.service_id IS NULL
     GROUP BY sss.service_id
     ORDER BY amount_usdc DESC
     LIMIT ${top}
  `);

  if (unmapped.rows.length === 0) {
    console.log("[backfill-aliases] no unmapped service_ids — dictionary complete");
    return;
  }
  console.warn(
    `[backfill-aliases] WARN: ${unmapped.rows.length} unmapped service_ids (top ${top} by spend):`,
  );
  for (const r of unmapped.rows) {
    console.warn(
      `  ${r.service_id}  $${Number(r.amount_usdc).toFixed(2)}  ${r.channels} channels`,
    );
  }
  console.warn(
    "[backfill-aliases] To enrich: discover the raw string via seller logs/PR, then INSERT into service_id_aliases manually.",
  );
}

main().catch((e) => {
  console.error("[backfill-aliases] failed:", e);
  process.exit(1);
});
