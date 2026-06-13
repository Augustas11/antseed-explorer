// SPEC §11.9 — lock contention.
//
// The cleanest exercise of pg_try_advisory_xact_lock is two psql sessions —
// one holds the lock, the other runs the rebuild and observes zero writes.
// Neon HTTP can't hold a lock across requests (each db.execute is its own
// implicit transaction), so this script prints a manual recipe instead of
// attempting an in-process equivalent that wouldn't actually exercise the
// contention path.

import "dotenv/config";
import { skipIfNoDb } from "./_service-metadata-fixture";
import { getRebuildLockKey } from "../lib/serviceMetadata";

function main() {
  if (skipIfNoDb("test-lock-contention")) return;
  const key = getRebuildLockKey();
  console.log("✓ test-lock-contention (manual recipe — Neon HTTP cannot hold the lock across requests)");
  console.log("");
  console.log("  Session A (psql):");
  console.log(`    BEGIN;`);
  console.log(`    SELECT pg_advisory_xact_lock(${key}::bigint);`);
  console.log("");
  console.log("  Session B (Node):");
  console.log("    DATABASE_URL=… npx tsx -e \"import('./lib/serviceMetadata').then(m => m.recomputeServiceMetadata())\"");
  console.log("");
  console.log("  Then back in Session A:");
  console.log(`    COMMIT;`);
  console.log("");
  console.log("  Expected: Session B completes with no error and zero writes.");
}

main();
