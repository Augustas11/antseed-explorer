// One-shot offline drain of events.metadata_decode_status='pending' rows.
//
// Fast-path version: for initial backfill we know rows are pending and have
// no prior snapshots, so phase 0a (status back-flip) and phase 0b (snapshot
// prune) are pure overhead. Skip both. v1/empty/decode_failed rows then need
// 1 round-trip (status flip only); v2 rows need 2 (bulk INSERT + status).
// Most historical settled events are pre-v0.1.103 v1.
//
// Idempotent — re-running picks up wherever it left off, and applyDecoded
// Settlement still runs through the in-cron worker so any rows that hit a
// transient error get redone properly.
//
// Usage:
//   DATABASE_URL=… npx tsx scripts/backfill-pending-metadata.ts [--concurrency 30] [--page 1000]

import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../lib/db";
import {
  decodeMetadata,
  terminalStatusOf,
  usdcFromAmount,
} from "../lib/metadata";
import { recomputeServiceMetadata } from "../lib/serviceMetadata";

const DEFAULT_CONCURRENCY = 30;
const DEFAULT_PAGE = 1000;
const PROGRESS_EVERY_MS = 5_000;

function parseArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function extractMetadataFromRawLog(rawLog: string | null): string | null {
  if (!rawLog) return null;
  try {
    const parsed = JSON.parse(rawLog) as { args?: { metadata?: unknown } };
    const m = parsed?.args?.metadata;
    return typeof m === "string" ? m : null;
  } catch {
    return null;
  }
}

type PendingRow = {
  tx_hash: string;
  log_index: number;
  channel_id: string | null;
  block_number: number;
  timestamp: number | null;
  raw_log: string | null;
} & Record<string, unknown>;

async function pageOfPending(limit: number): Promise<PendingRow[]> {
  const r = await db.execute<PendingRow>(sql`
    SELECT tx_hash, log_index, channel_id, block_number, timestamp, raw_log
      FROM events
     WHERE event_type = 'settled'
       AND metadata_decode_status = 'pending'
     ORDER BY block_number ASC, log_index ASC
     LIMIT ${limit}
  `);
  return r.rows;
}

// Fast-path applyDecodedSettlement for the initial backfill case.
// Assumes the row is currently 'pending' and has no prior snapshot rows.
// Skips phases 0a and 0b. v1/empty/decode_failed → 1 round-trip. v2 → 2.
async function applyFreshSettlement(row: PendingRow): Promise<void> {
  if (!row.channel_id) {
    // Same handling as the in-cron worker — flip to decode_failed so the row
    // doesn't sit pending forever and skew coverage stats.
    await db.execute(sql`
      UPDATE events
         SET metadata_decode_status = 'decode_failed',
             metadata_decoded_at    = ${Math.floor(Date.now() / 1000)}
       WHERE tx_hash = ${row.tx_hash} AND log_index = ${row.log_index}
    `);
    return;
  }

  const metadata = extractMetadataFromRawLog(row.raw_log);
  const decoded = decodeMetadata(metadata);
  const status = terminalStatusOf(decoded);

  // Phase 1 — bulk-insert per-service snapshots (v2 only).
  if (decoded.version === 2 && decoded.services.length > 0) {
    const values = sql.join(
      decoded.services.map(
        (s) => sql`(${row.tx_hash}, ${row.log_index}, ${row.channel_id}, ${s.serviceId},
          ${Number(row.block_number)}, ${Number(row.timestamp ?? 0)},
          ${usdcFromAmount(s.cumulativeAmount)},
          ${Number(s.cumulativeInputTokens)},
          ${Number(s.cumulativeCachedInputTokens)},
          ${Number(s.cumulativeOutputTokens)},
          ${Number(s.cumulativeRequestCount)})`,
      ),
      sql`, `,
    );
    await db.execute(sql`
      INSERT INTO settlement_service_snapshots
        (tx_hash, log_index, channel_id, service_id, block_number, timestamp,
         cumulative_amount_usdc, cumulative_in_tokens, cumulative_cached_in_tokens,
         cumulative_out_tokens, cumulative_requests)
      VALUES ${values}
      ON CONFLICT (tx_hash, log_index, service_id) DO UPDATE
        SET channel_id                  = EXCLUDED.channel_id,
            block_number                = EXCLUDED.block_number,
            timestamp                   = EXCLUDED.timestamp,
            cumulative_amount_usdc      = EXCLUDED.cumulative_amount_usdc,
            cumulative_in_tokens        = EXCLUDED.cumulative_in_tokens,
            cumulative_cached_in_tokens = EXCLUDED.cumulative_cached_in_tokens,
            cumulative_out_tokens       = EXCLUDED.cumulative_out_tokens,
            cumulative_requests         = EXCLUDED.cumulative_requests
    `);
  }

  // Phase 2 — completion marker.
  await db.execute(sql`
    UPDATE events
       SET metadata_decode_status = ${status},
           metadata_decoded_at    = ${Math.floor(Date.now() / 1000)}
     WHERE tx_hash   = ${row.tx_hash}
       AND log_index = ${row.log_index}
  `);
}

async function dispatchParallel(rows: PendingRow[], concurrency: number) {
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= rows.length) return;
      const row = rows[idx]!;
      try {
        await applyFreshSettlement(row);
      } catch (e) {
        console.warn(
          `[drain] ${row.tx_hash}:${row.log_index} failed:`,
          (e as Error)?.message ?? e,
        );
      }
    }
  });
  await Promise.all(workers);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const concurrency = parseArg("concurrency", DEFAULT_CONCURRENCY);
  const page = parseArg("page", DEFAULT_PAGE);

  const totalRow = await db.execute<{ n: number } & Record<string, unknown>>(sql`
    SELECT COUNT(*)::int AS n FROM events
     WHERE event_type = 'settled' AND metadata_decode_status = 'pending'
  `);
  const totalPending = Number(totalRow.rows[0]?.n ?? 0);
  if (totalPending === 0) {
    console.log("✓ nothing to drain");
    return;
  }

  console.log(
    `[drain] starting: ${totalPending} pending settled events, concurrency=${concurrency}, page=${page}`,
  );
  const startedAt = Date.now();
  let processed = 0;
  let lastProgress = Date.now();

  while (true) {
    const rows = await pageOfPending(page);
    if (rows.length === 0) break;
    await dispatchParallel(rows, concurrency);
    processed += rows.length;

    if (Date.now() - lastProgress > PROGRESS_EVERY_MS) {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      const rate = processed / elapsedSec;
      const remaining = Math.max(0, totalPending - processed);
      const etaSec = rate > 0 ? remaining / rate : Infinity;
      console.log(
        `[drain] ${processed}/${totalPending} (${rate.toFixed(0)}/s, ETA ${
          Number.isFinite(etaSec) ? `${Math.round(etaSec / 60)}m` : "∞"
        })`,
      );
      lastProgress = Date.now();
    }
  }

  const elapsedSec = (Date.now() - startedAt) / 1000;
  console.log(
    `[drain] drained ${processed} events in ${elapsedSec.toFixed(0)}s (${(
      processed / elapsedSec
    ).toFixed(0)}/s)`,
  );

  console.log("[drain] running recomputeServiceMetadata() to publish rollups …");
  await recomputeServiceMetadata();
  console.log("[drain] ✓ done");

  const summary = await db.execute<Record<string, unknown>>(sql`
    SELECT metadata_decode_status, COUNT(*)::int AS n
      FROM events WHERE event_type = 'settled'
     GROUP BY metadata_decode_status
     ORDER BY n DESC
  `);
  console.log("[drain] final settled-event status:", summary.rows);
  const sssCount = await db.execute<{ n: number } & Record<string, unknown>>(
    sql`SELECT COUNT(*)::int AS n FROM settlement_service_snapshots`,
  );
  console.log(
    "[drain] settlement_service_snapshots row count:",
    sssCount.rows[0]?.n,
  );
  const cstCount = await db.execute<{ n: number } & Record<string, unknown>>(
    sql`SELECT COUNT(*)::int AS n FROM channel_service_totals`,
  );
  console.log("[drain] channel_service_totals row count:", cstCount.rows[0]?.n);
  const dsmCount = await db.execute<{ n: number } & Record<string, unknown>>(
    sql`SELECT COUNT(*)::int AS n FROM daily_service_metrics`,
  );
  console.log("[drain] daily_service_metrics row count:", dsmCount.rows[0]?.n);
}

main().catch((e) => {
  console.error("[drain] failed:", e);
  process.exit(1);
});
