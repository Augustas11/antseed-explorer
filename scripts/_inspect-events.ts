import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const checks = [
    {
      name: "indexer_state",
      q: sql`SELECT key, value FROM indexer_state ORDER BY key`,
    },
    {
      name: "events.event_type counts",
      q: sql`SELECT event_type, COUNT(*)::int AS n, MIN(block_number)::bigint AS min_block, MAX(block_number)::bigint AS max_block, MIN(timestamp)::bigint AS min_ts, MAX(timestamp)::bigint AS max_ts FROM events GROUP BY 1 ORDER BY 1`,
    },
    {
      name: "settled events by month",
      q: sql`SELECT to_char(to_timestamp(timestamp), 'YYYY-MM') AS month, COUNT(*)::int AS n, COALESCE(SUM(delta_usdc),0)::float AS volume FROM events WHERE event_type='settled' GROUP BY 1 ORDER BY 1`,
    },
    {
      name: "earliest 5 settled events",
      q: sql`SELECT block_number::bigint, timestamp::bigint, delta_usdc, buyer_address FROM events WHERE event_type='settled' ORDER BY block_number ASC LIMIT 5`,
    },
    {
      name: "settled events with timestamp NULL or 0",
      q: sql`SELECT COUNT(*)::int AS bad_ts FROM events WHERE event_type='settled' AND (timestamp IS NULL OR timestamp <= 0)`,
    },
    {
      name: "buyer_profiles first_seen_block distribution",
      q: sql`SELECT MIN(first_seen_block)::bigint AS min_first, MAX(first_seen_block)::bigint AS max_first, COUNT(*)::int AS n FROM buyer_profiles`,
    },
    {
      name: "settled events block ranges (10k chunks)",
      q: sql`SELECT (block_number / 50000) * 50000 AS chunk_start, COUNT(*)::int AS n, MIN(timestamp)::bigint AS min_ts, MAX(timestamp)::bigint AS max_ts FROM events WHERE event_type='settled' GROUP BY 1 ORDER BY 1`,
    },
  ];

  for (const c of checks) {
    console.log("\n=== " + c.name + " ===");
    try {
      const r = await db.execute<any>(c.q);
      console.log(JSON.stringify(r.rows, null, 2));
    } catch (e) {
      console.log("ERROR:", (e as Error).message);
    }
  }
  process.exit(0);
}
main();
