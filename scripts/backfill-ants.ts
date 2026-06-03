// Dedicated $ANT Transfer backfill. Holds the global sync lock so the prod
// cron's ANTS sync cannot race and double-apply deltas, then runs
// syncAntsToken with a long deadline until the cursor catches up to head.
//
//   DATABASE_URL=… RPC_URL=… npx tsx scripts/backfill-ants.ts
//
// Safe to interrupt: cursor is persisted after every batch, lock auto-expires
// after staleAfterMs (default 90s in tryAcquireSyncLock).

import "dotenv/config";
import { syncAntsToken } from "../lib/indexer";
import { tryAcquireSyncLock, releaseSyncLock, getState, setState } from "../lib/db";

const ITER_DEADLINE_MS = 60_000; // per-call budget for syncAntsToken
// staleAfterMs threshold for stealing the lock. Must be ≤ what the prod cron
// uses (90s) so we steal as soon as their TTL expires. Smaller = more
// aggressive contention; we run longer than ITER_DEADLINE_MS so this also
// caps how stale our own lock can become without interrupting us.
const LOCK_STALE_MS = 60_000;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  if (!process.env.RPC_URL) {
    console.error("RPC_URL is required");
    process.exit(1);
  }

  for (let i = 1; i <= 200; i++) {
    // Re-acquire each iteration so the lock TTL keeps refreshing.
    const lockOwner = await tryAcquireSyncLock(LOCK_STALE_MS);
    if (!lockOwner) {
      console.log(`iter ${i}: lock held by another process, retrying in 3s`);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    const before = await getState("last_indexed_block_ants_token");
    const t0 = Date.now();
    const r = await syncAntsToken({ deadlineMs: ITER_DEADLINE_MS });
    const elapsed = Date.now() - t0;
    await setState("last_sync_ts", Date.now().toString());
    await releaseSyncLock(lockOwner);

    const after = await getState("last_indexed_block_ants_token");
    const advanced = Number(after ?? 0) - Number(before ?? 0);
    console.log(
      `iter ${i}: ${elapsed}ms advanced=${advanced.toLocaleString()} cursor=${Number(after ?? 0).toLocaleString()} fromBlock=${r.fromBlock} toBlock=${r.toBlock} transfers=${r.transfersProcessed} holdersTouched=${r.holdersTouched} ${r.error ? `err=${r.error}` : ""}`,
    );

    // Caught up: getLogs returned empty range (fromBlock > head from caller's view).
    if (r.ok && r.transfersProcessed === 0 && advanced === 0 && !r.error) {
      console.log("caught up to chain head.");
      break;
    }
    if (!r.ok) {
      console.error("non-recoverable error:", r.error);
      break;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
