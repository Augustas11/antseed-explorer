import "dotenv/config";
import { getState } from "../lib/db";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

(async () => {
  console.log("last_indexed_block_identity_registry:", await getState("last_indexed_block_identity_registry"));
  console.log("log_batch_size_identity_registry:", await getState("log_batch_size_identity_registry"));
  const c = await db.execute<{ event_type: string; n: string; min_b: string; max_b: string }>(sql`
    SELECT event_type, COUNT(*)::text AS n,
           MIN(block_number)::text AS min_b,
           MAX(block_number)::text AS max_b
    FROM events
    WHERE event_type IN ('identity_registered','identity_uri_updated','identity_metadata_set')
    GROUP BY event_type
    ORDER BY event_type
  `);
  console.log("\nrows by event_type:", c.rows);
})();
