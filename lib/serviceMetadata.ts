// Per-model attribution pipeline (SPEC §5.3 + §5.5 + §5.6).
//
// On-chain ChannelSettled.metadata is decoded into:
//   - the legacy v1 aggregate counters (already populated by lib/indexer)
//   - the v2 ServiceTotal[] per-service absolute counters, which this module
//     persists in settlement_service_snapshots
//
// Two-phase write per applied settlement (idempotent under any retry):
//   phase 0a: back-flip events.metadata_decode_status → 'pending'
//             (rebuilds gate on 'v2', so an in-flight re-decode is invisible)
//   phase 0b: prune stale snapshots that aren't in the new serviceId set
//   phase 1:  upsert one row per service into settlement_service_snapshots
//   phase 2:  flip status to the terminal value — the completion marker
//
// The derived rollups (channel_service_totals + daily_service_metrics) are
// never updated incrementally; they're rebuilt by recomputeServiceMetadata()
// in one writable-CTE statement on the cron tick. Ingest is conflict-free.

import { sql } from "drizzle-orm";
import { db } from "./db";
import {
  decodeMetadata,
  terminalStatusOf,
  usdcFromAmount,
  type DecodedMetadata,
} from "./metadata";

export interface SettlementInput {
  txHash: string;
  logIndex: number;
  channelId: string;
  blockNumber: number;
  timestamp: number;
  metadata: string | null | undefined;
}

// The lock key is a fixed bigint derived from hashtext('rebuild_service_metadata').
// Hardcoded so a single statement can reference it via rawNonNegativeInteger;
// re-computing via hashtext() at runtime would defeat the purpose.
// SPEC §5.5 — the lock CTE acquires this key inside the rebuild statement so
// pg_try_advisory_xact_lock cannot be released by Neon HTTP's autocommit
// before the writes run.
const REBUILD_LOCK_KEY = 0xdeadbeef;

export function getRebuildLockKey(): number {
  return REBUILD_LOCK_KEY;
}

// SPEC §5.3 — atomic for the row, idempotent, replay-proof.
export async function applyDecodedSettlement(row: SettlementInput): Promise<void> {
  const decoded = decodeMetadata(row.metadata);
  const status = terminalStatusOf(decoded);

  // Phase 0a — back-flip status to 'pending' so any rebuild in progress that
  // had the prior terminal row in its snapshot set ignores the in-flight row.
  await db.execute(sql`
    UPDATE events
       SET metadata_decode_status = 'pending',
           metadata_decoded_at    = NULL
     WHERE tx_hash   = ${row.txHash}
       AND log_index = ${row.logIndex}
       AND metadata_decode_status <> 'pending'
  `);

  // Phase 0b — prune snapshots that aren't in the current decoded service set.
  // `<> ALL($arr)` cleanly handles the empty-array case: with `'{}'::text[]`
  // every existing row matches (i.e. wipes them) for terminal v1/empty/decode_failed.
  const serviceIdArray = decoded.version === 2 ? decoded.services.map((s) => s.serviceId) : [];
  await db.execute(sql`
    DELETE FROM settlement_service_snapshots
     WHERE tx_hash    = ${row.txHash}
       AND log_index  = ${row.logIndex}
       AND service_id <> ALL(${serviceIdArray}::text[])
  `);

  // Phase 1 — write per-service snapshots (v2 only).
  if (decoded.version === 2) {
    for (const s of decoded.services) {
      await db.execute(sql`
        INSERT INTO settlement_service_snapshots
          (tx_hash, log_index, channel_id, service_id, block_number, timestamp,
           cumulative_amount_usdc, cumulative_in_tokens, cumulative_cached_in_tokens,
           cumulative_out_tokens, cumulative_requests)
        VALUES (
          ${row.txHash}, ${row.logIndex}, ${row.channelId}, ${s.serviceId},
          ${row.blockNumber}, ${row.timestamp},
          ${usdcFromAmount(s.cumulativeAmount)},
          ${Number(s.cumulativeInputTokens)},
          ${Number(s.cumulativeCachedInputTokens)},
          ${Number(s.cumulativeOutputTokens)},
          ${Number(s.cumulativeRequestCount)}
        )
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
  }

  // Phase 2 — completion marker. If we crash before this, the row stays
  // 'pending' and the backfill worker redoes phases 0-1 idempotently.
  const now = Math.floor(Date.now() / 1000);
  await db.execute(sql`
    UPDATE events
       SET metadata_decode_status = ${status},
           metadata_decoded_at    = ${now}
     WHERE tx_hash   = ${row.txHash}
       AND log_index = ${row.logIndex}
  `);

  if (status === "decode_failed") {
    console.warn(
      `[metadata] decode_failed for ${row.txHash}:${row.logIndex} (channel=${row.channelId})`,
    );
  }
}

// Backfill worker — pages over settled events whose metadata hasn't been
// decoded yet and applies them. Idempotent so a crash mid-batch is harmless.
export async function decodePendingMetadata(limit = 200): Promise<number> {
  const safeLimit = Math.max(1, Math.min(2000, Math.floor(limit)));
  const rows = await db.execute<{
    tx_hash: string;
    log_index: number;
    channel_id: string | null;
    block_number: number;
    timestamp: number | null;
    raw_log: string | null;
  }>(sql`
    SELECT tx_hash, log_index, channel_id, block_number, timestamp, raw_log
      FROM events
     WHERE event_type = 'settled'
       AND metadata_decode_status = 'pending'
     ORDER BY block_number ASC, log_index ASC
     LIMIT ${safeLimit}
  `);

  let processed = 0;
  for (const r of rows.rows) {
    if (!r.channel_id) continue;
    const metadata = extractMetadataFromRawLog(r.raw_log);
    await applyDecodedSettlement({
      txHash: r.tx_hash,
      logIndex: r.log_index,
      channelId: r.channel_id,
      blockNumber: Number(r.block_number),
      timestamp: Number(r.timestamp ?? 0),
      metadata,
    });
    processed += 1;
  }
  return processed;
}

// raw_log is the JSON-serialized viem Log object captured at indexer time.
// The metadata bytes live at args.metadata.
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

// Re-export the decoded type so callers don't need to know about lib/metadata.
export type { DecodedMetadata } from "./metadata";
