// Reset the identity-registry indexer cursor and any rows it wrote so we
// can do a clean full backfill against a different RPC.
import "dotenv/config";
import { db, setState } from "../lib/db";
import { sql } from "drizzle-orm";

(async () => {
  await db.execute(sql`DELETE FROM events WHERE event_type IN ('identity_registered','identity_uri_updated','identity_metadata_set')`);
  await db.execute(sql`DELETE FROM indexer_state WHERE key IN ('last_indexed_block_identity_registry','log_batch_size_identity_registry')`);
  console.log("reset done");
})();
