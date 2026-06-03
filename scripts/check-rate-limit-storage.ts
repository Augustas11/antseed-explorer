import "dotenv/config";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  assert.ok(
    process.env.DATABASE_URL,
    "DATABASE_URL is required to verify shared rate-limit storage",
  );

  const result = await db.execute<{
    table_exists: boolean;
    index_exists: boolean;
  }>(sql`
    SELECT
      to_regclass('public.rate_limit_buckets') IS NOT NULL AS table_exists,
      to_regclass('public.rate_limit_buckets_window_idx') IS NOT NULL AS index_exists
  `);
  const row = result.rows[0];
  assert.equal(row?.table_exists, true, "rate_limit_buckets table is missing");
  assert.equal(row?.index_exists, true, "rate_limit_buckets_window_idx index is missing");

  console.log("Shared rate-limit storage is present");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
