// One-shot: set the AntseedDeposits cursor to head, then recompute daily_dau
// for every day in the dataset. Run once after _backfill-deposits.ts.

import "dotenv/config";
import { recomputeDailyDauAll } from "../lib/indexer";
import { setState, getState, db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db.execute<{ max_b: string | null }>(
    sql`SELECT MAX(block_number)::bigint AS max_b FROM events WHERE event_type IN ('deposited','withdrawal_executed')`,
  );
  const maxBlock = r.rows[0]?.max_b ? BigInt(r.rows[0].max_b) : null;
  if (maxBlock) {
    await setState("last_indexed_block_antseed_deposits", maxBlock.toString());
    console.log("[backfill-dau] set last_indexed_block_antseed_deposits =", maxBlock.toString());
  } else {
    console.log("[backfill-dau] no deposits events found — skipping cursor update");
  }
  const n = await recomputeDailyDauAll();
  console.log("[backfill-dau] recomputed", n, "days in daily_dau");

  // Print a few sample rows for spot check.
  const sample = await db.execute<any>(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, dau, dau_buyers, dau_sellers, new_users
    FROM daily_dau ORDER BY day ASC
  `);
  console.log("[backfill-dau] rows:");
  for (const row of sample.rows) {
    console.log(`  ${row.day}  dau=${row.dau}  buyers=${row.dau_buyers}  sellers=${row.dau_sellers}  new=${row.new_users}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
