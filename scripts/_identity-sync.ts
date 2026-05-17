// One-shot backfill for the ERC-8004 IdentityRegistry pass. Loops the
// indexer until it reports caught-up, then prints row count and a sample
// row from the events table. Run with:
//   DATABASE_URL=... RPC_URL=... npx tsx scripts/_identity-sync.ts

import "dotenv/config";
import { syncIdentityRegistry } from "../lib/indexer";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  let errStreak = 0;
  for (let i = 1; i <= 2000; i++) {
    const r = await syncIdentityRegistry({ deadlineMs: 50_000 });
    console.log(`pass ${i}: ok=${r.ok} from=${r.fromBlock} to=${r.toBlock} added=${r.recordsAdded}${r.error ? ` error="${(r.error || "").slice(0, 80)}"` : ""}`);
    if (!r.ok) {
      errStreak++;
      if (errStreak >= 5) {
        console.log("too many consecutive RPC errors, stopping.");
        break;
      }
      await new Promise((res) => setTimeout(res, 2000));
      continue;
    }
    errStreak = 0;
    // The indexer returns recordsAdded with no error when it walked all
    // the way to head. fromBlockStart > head is the only no-error,
    // no-deadline path.
    if (!r.error && BigInt(r.toBlock) === BigInt(r.fromBlock) - 1n) {
      // Caught-up signal: fromBlockStart > head means the function returned
      // with toBlock = head, fromBlock = head + 1 (i.e. lastIndexed+1 > head).
      // But the function actually returns fromBlock=head+1, toBlock=head when
      // there's nothing to do. Easier: stop when no rows added AND the
      // last_indexed_block is at chain head.
    }
    if (!r.error) {
      console.log("caught up.");
      break;
    }
  }

  const counts = await db.execute<{
    event_type: string;
    n: string;
  }>(sql`
    SELECT event_type, COUNT(*)::text AS n
    FROM events
    WHERE event_type IN ('identity_registered','identity_uri_updated','identity_metadata_set')
    GROUP BY event_type
    ORDER BY event_type
  `);
  console.log("\nrow counts by event_type:");
  for (const r of counts.rows) console.log(`  ${r.event_type}: ${r.n}`);

  const sample = await db.execute(sql`
    SELECT *
    FROM events
    WHERE event_type IN ('identity_registered','identity_uri_updated','identity_metadata_set')
    ORDER BY block_number ASC, log_index ASC
    LIMIT 1
  `);
  console.log("\nsample row:");
  console.log(JSON.stringify(sample.rows[0], null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
