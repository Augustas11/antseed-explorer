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
import { rawNonNegativeInteger } from "./sqlSafe";

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
// Thin wrapper over applyDecodedSettlementsBulk for callers with a single row.
export async function applyDecodedSettlement(row: SettlementInput): Promise<void> {
  await applyDecodedSettlementsBulk([row]);
}

// Bulk variant — applies N settlements in 4 Neon round-trips total instead of
// 4×N. The per-row variant exists as a wrapper for single-call sites
// (test fixtures, etc.). The live channels indexer and the backfill worker
// both go through this path so a 250-settlement batch costs 4 HTTP calls
// instead of 1,000.
//
// Atomicity is per-statement, not per-batch — if phase 1 fails the snapshot
// for some rows may have already been pruned in phase 0b. That matches the
// pre-bulk behaviour (each row was 4 separate autocommit statements before).
// All rows remain in 'pending' until phase 2 finishes, so the rebuild's
// `channel_pending_min` gate keeps stragglers out of the rollup until the
// next backfill pass re-applies them.
export async function applyDecodedSettlementsBulk(
  rows: SettlementInput[],
): Promise<void> {
  if (rows.length === 0) return;

  // Decode once per row up front.
  const decoded = rows.map((row) => {
    const meta = decodeMetadata(row.metadata);
    return { row, meta, status: terminalStatusOf(meta) };
  });

  // (tx_hash, log_index) tuple set used by phases 0a, 0b, and (implicitly) 2.
  const idTuples = sql.join(
    decoded.map((d) => sql`(${d.row.txHash}, ${d.row.logIndex}::int)`),
    sql`, `,
  );

  // Phase 0a — back-flip any row whose current terminal status is being
  // overwritten so an in-flight rebuild doesn't see it in the snapshot set.
  // In steady state most rows are already 'pending' and this UPDATE matches
  // zero rows; keeping it makes re-decode of terminal rows safe.
  await db.execute(sql`
    UPDATE events
       SET metadata_decode_status = 'pending',
           metadata_decoded_at    = NULL
     WHERE (tx_hash, log_index) IN (${idTuples})
       AND metadata_decode_status <> 'pending'
  `);

  // Phase 0b — prune stale snapshots. The "keep" set is the union of
  // (tx_hash, log_index, service_id) tuples decoded for v2-with-services
  // rows; everything else (v1/empty/decode_failed/v2-no-services) keeps
  // nothing and drops all snapshots for that settlement. Done with a
  // NOT EXISTS join against the keep tuples — equivalent to the per-row
  // version's "service_id NOT IN (...)" check, but unified across the batch.
  const keepRows: Array<{ txHash: string; logIndex: number; serviceId: string }> = [];
  for (const d of decoded) {
    if (d.meta.version === 2 && d.meta.services.length > 0) {
      for (const s of d.meta.services) {
        keepRows.push({
          txHash: d.row.txHash,
          logIndex: d.row.logIndex,
          serviceId: s.serviceId,
        });
      }
    }
  }
  if (keepRows.length > 0) {
    const keepTuples = sql.join(
      keepRows.map(
        (k) => sql`(${k.txHash}, ${k.logIndex}::int, ${k.serviceId})`,
      ),
      sql`, `,
    );
    await db.execute(sql`
      DELETE FROM settlement_service_snapshots AS s
       WHERE (s.tx_hash, s.log_index) IN (${idTuples})
         AND NOT EXISTS (
           SELECT 1
             FROM (VALUES ${keepTuples}) AS k(tx_hash, log_index, service_id)
            WHERE k.tx_hash   = s.tx_hash
              AND k.log_index = s.log_index
              AND k.service_id = s.service_id
         )
    `);
  } else {
    await db.execute(sql`
      DELETE FROM settlement_service_snapshots
       WHERE (tx_hash, log_index) IN (${idTuples})
    `);
  }

  // Phase 1 — bulk INSERT every v2 service snapshot across the entire batch
  // in one statement. The metadata decoder caps services at MAX_DECODED_
  // SERVICES (lib/metadata.ts) and the live path caps the batch size via the
  // indexer's getLogs window, so the VALUES list stays well under any
  // reasonable parameter cap.
  type InsertRow = {
    txHash: string;
    logIndex: number;
    channelId: string;
    serviceId: string;
    blockNumber: number;
    timestamp: number;
    amountUsdc: number;
    inTokens: number;
    cachedInTokens: number;
    outTokens: number;
    requests: number;
  };
  const inserts: InsertRow[] = [];
  for (const d of decoded) {
    if (d.meta.version === 2 && d.meta.services.length > 0) {
      for (const s of d.meta.services) {
        inserts.push({
          txHash: d.row.txHash,
          logIndex: d.row.logIndex,
          channelId: d.row.channelId,
          serviceId: s.serviceId,
          blockNumber: d.row.blockNumber,
          timestamp: d.row.timestamp,
          amountUsdc: usdcFromAmount(s.cumulativeAmount),
          inTokens: Number(s.cumulativeInputTokens),
          cachedInTokens: Number(s.cumulativeCachedInputTokens),
          outTokens: Number(s.cumulativeOutputTokens),
          requests: Number(s.cumulativeRequestCount),
        });
      }
    }
  }
  if (inserts.length > 0) {
    const values = sql.join(
      inserts.map(
        (v) => sql`(${v.txHash}, ${v.logIndex}::int, ${v.channelId}, ${v.serviceId},
          ${v.blockNumber}::bigint, ${v.timestamp}::bigint,
          ${v.amountUsdc}::double precision,
          ${v.inTokens}::bigint,
          ${v.cachedInTokens}::bigint,
          ${v.outTokens}::bigint,
          ${v.requests}::bigint)`,
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

  // Phase 2 — bulk completion marker. UPDATE...FROM (VALUES ...) joins the
  // per-row terminal status in one statement.
  const now = Math.floor(Date.now() / 1000);
  const statusTuples = sql.join(
    decoded.map(
      (d) => sql`(${d.row.txHash}, ${d.row.logIndex}::int, ${d.status}::text)`,
    ),
    sql`, `,
  );
  await db.execute(sql`
    UPDATE events e
       SET metadata_decode_status = v.status,
           metadata_decoded_at    = ${now}
      FROM (VALUES ${statusTuples}) AS v(tx_hash, log_index, status)
     WHERE e.tx_hash   = v.tx_hash
       AND e.log_index = v.log_index
  `);

  for (const d of decoded) {
    if (d.status === "decode_failed") {
      console.warn(
        `[metadata] decode_failed for ${d.row.txHash}:${d.row.logIndex} (channel=${d.row.channelId})`,
      );
    }
  }
}

// Backfill worker — pages over settled events whose metadata hasn't been
// decoded yet and applies them in one bulk call. Idempotent so a crash mid-
// batch is harmless (next call repicks any rows still 'pending').
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
  if (rows.rows.length === 0) return 0;

  // Rows with NULL channel_id can't fan out per-service snapshots. Flip them
  // terminal in one UPDATE so they stop counting toward pending_usdc on
  // every coverage CTE, and exclude them from the bulk decode path below.
  const noChannel = rows.rows.filter((r) => !r.channel_id);
  if (noChannel.length > 0) {
    const noChannelTuples = sql.join(
      noChannel.map((r) => sql`(${r.tx_hash}, ${r.log_index}::int)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE events
         SET metadata_decode_status = 'decode_failed',
             metadata_decoded_at    = ${Math.floor(Date.now() / 1000)}
       WHERE (tx_hash, log_index) IN (${noChannelTuples})
    `);
  }

  const decodable = rows.rows.filter((r): r is typeof r & { channel_id: string } =>
    Boolean(r.channel_id),
  );
  if (decodable.length > 0) {
    await applyDecodedSettlementsBulk(
      decodable.map((r) => ({
        txHash: r.tx_hash,
        logIndex: r.log_index,
        channelId: r.channel_id,
        blockNumber: Number(r.block_number),
        timestamp: Number(r.timestamp ?? 0),
        metadata: extractMetadataFromRawLog(r.raw_log),
      })),
    );
  }
  return rows.rows.length;
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

// SPEC §5.5 — one atomic writable-CTE statement that rebuilds both
// channel_service_totals and daily_service_metrics from
// settlement_service_snapshots (the absolute source of truth).
//
// Why this shape:
//   - lock CTE acquires pg_try_advisory_xact_lock IN this statement so the
//     lock cannot be released by Neon HTTP's autocommit before the writes.
//   - channel_pending_min gates rebuild to the prefix-complete history per
//     channel (rebuild can't see snapshots whose channel has earlier pending
//     settled events — keeps LAG() and pre-v2 baseline accurate mid-backfill).
//   - channel_v2_boundary scopes the zero-baseline rule to first snapshots AT
//     the channel's earliest v2 (block, log_index); services first seen later
//     are clean post-migration introductions.
//   - per_settlement_scale is computed from baseline_deltas (post-zero-
//     baseline) — otherwise zeroed services would shrink the scale factor.
//   - cst_target / dsm_target HAVING gates out all-zero published rows so the
//     buyer/seller/channel counts on /models aren't inflated by zero-baseline
//     first snapshots.
export async function recomputeServiceMetadata(): Promise<void> {
  await db.execute(sql`
    WITH
      lock AS (
        SELECT pg_try_advisory_xact_lock(${rawNonNegativeInteger(REBUILD_LOCK_KEY, "rebuild lock key")}::bigint) AS acquired
      ),

      channel_pending_min AS (
        SELECT DISTINCT ON (channel_id)
               channel_id,
               block_number AS first_pending_block,
               log_index    AS first_pending_log_index
          FROM events
         WHERE event_type = 'settled'
           AND metadata_decode_status = 'pending'
           AND channel_id IS NOT NULL
         ORDER BY channel_id, block_number ASC, log_index ASC
      ),

      decoded_snapshots AS (
        SELECT sss.*
          FROM settlement_service_snapshots sss
          JOIN events e
            ON e.tx_hash   = sss.tx_hash
           AND e.log_index = sss.log_index
          LEFT JOIN channel_pending_min cpm
            ON cpm.channel_id = sss.channel_id
         WHERE e.metadata_decode_status = 'v2'
           AND (cpm.first_pending_block IS NULL
                OR (sss.block_number, sss.log_index)
                   < (cpm.first_pending_block, cpm.first_pending_log_index))
      ),

      channel_settlement_caps AS (
        SELECT tx_hash, log_index, COALESCE(delta_usdc, 0)::double precision AS delta_usdc
          FROM events
         WHERE event_type = 'settled'
           AND metadata_decode_status = 'v2'
      ),

      channel_v2_boundary AS (
        SELECT DISTINCT ON (channel_id)
               channel_id,
               block_number AS first_v2_block,
               log_index    AS first_v2_log_index
          FROM decoded_snapshots
         ORDER BY channel_id, block_number ASC, log_index ASC
      ),

      channel_pre_v2_min AS (
        SELECT DISTINCT ON (channel_id)
               channel_id,
               block_number AS min_pre_v2_block,
               log_index    AS min_pre_v2_log_index
          FROM events
         WHERE event_type = 'settled'
           AND metadata_decode_status IN ('v1','empty','decode_failed')
           AND channel_id IS NOT NULL
         ORDER BY channel_id, block_number ASC, log_index ASC
      ),

      raw_deltas AS (
        SELECT
          ds.tx_hash, ds.log_index, ds.channel_id, ds.service_id,
          ds.block_number, ds.timestamp,
          (to_timestamp(ds.timestamp) AT TIME ZONE 'UTC')::date AS day,
          LAG(ds.cumulative_amount_usdc, 1) OVER w IS NULL AS is_first,
          GREATEST(ds.cumulative_amount_usdc      - LAG(ds.cumulative_amount_usdc, 1, 0::double precision) OVER w, 0) AS delta_amount_usdc_raw,
          GREATEST(ds.cumulative_in_tokens         - LAG(ds.cumulative_in_tokens, 1, 0::bigint) OVER w, 0) AS delta_in_tokens_raw,
          GREATEST(ds.cumulative_cached_in_tokens  - LAG(ds.cumulative_cached_in_tokens, 1, 0::bigint) OVER w, 0) AS delta_cached_in_tokens_raw,
          GREATEST(ds.cumulative_out_tokens        - LAG(ds.cumulative_out_tokens, 1, 0::bigint) OVER w, 0) AS delta_out_tokens_raw,
          GREATEST(ds.cumulative_requests          - LAG(ds.cumulative_requests, 1, 0::bigint) OVER w, 0) AS delta_requests_raw
        FROM decoded_snapshots ds
        WINDOW w AS (PARTITION BY ds.channel_id, ds.service_id ORDER BY ds.block_number, ds.log_index)
      ),

      capped_deltas AS (
        SELECT
          rd.tx_hash, rd.log_index, rd.channel_id, rd.service_id,
          rd.block_number, rd.timestamp, rd.day,
          (cpv.min_pre_v2_block IS NOT NULL
            AND (cpv.min_pre_v2_block, cpv.min_pre_v2_log_index) < (rd.block_number, rd.log_index)
            AND (cvb.first_v2_block, cvb.first_v2_log_index) = (rd.block_number, rd.log_index)
          ) AS has_prior_pre_v2,
          CASE WHEN rd.is_first
               THEN LEAST(rd.delta_amount_usdc_raw, COALESCE(csc.delta_usdc, rd.delta_amount_usdc_raw))
               ELSE rd.delta_amount_usdc_raw
          END AS delta_amount_usdc_step1,
          rd.delta_in_tokens_raw,
          rd.delta_cached_in_tokens_raw,
          rd.delta_out_tokens_raw,
          rd.delta_requests_raw,
          rd.is_first
        FROM raw_deltas rd
        LEFT JOIN channel_settlement_caps csc ON csc.tx_hash = rd.tx_hash AND csc.log_index = rd.log_index
        LEFT JOIN channel_pre_v2_min   cpv    ON cpv.channel_id = rd.channel_id
        LEFT JOIN channel_v2_boundary  cvb    ON cvb.channel_id = rd.channel_id
      ),

      baseline_deltas AS (
        SELECT
          cd.tx_hash, cd.log_index, cd.channel_id, cd.service_id, cd.block_number, cd.timestamp, cd.day,
          cd.is_first, cd.has_prior_pre_v2,
          CASE WHEN cd.is_first AND cd.has_prior_pre_v2 THEN 0::double precision ELSE cd.delta_amount_usdc_step1   END AS delta_amount_usdc_baseline,
          CASE WHEN cd.is_first AND cd.has_prior_pre_v2 THEN 0::bigint           ELSE cd.delta_in_tokens_raw        END AS delta_in_tokens,
          CASE WHEN cd.is_first AND cd.has_prior_pre_v2 THEN 0::bigint           ELSE cd.delta_cached_in_tokens_raw END AS delta_cached_in_tokens,
          CASE WHEN cd.is_first AND cd.has_prior_pre_v2 THEN 0::bigint           ELSE cd.delta_out_tokens_raw       END AS delta_out_tokens,
          CASE WHEN cd.is_first AND cd.has_prior_pre_v2 THEN 0::bigint           ELSE cd.delta_requests_raw         END AS delta_requests
        FROM capped_deltas cd
      ),

      per_settlement_usdc_check AS (
        SELECT bd.tx_hash, bd.log_index,
               SUM(bd.delta_amount_usdc_baseline) AS sum_baseline
          FROM baseline_deltas bd
         GROUP BY bd.tx_hash, bd.log_index
      ),
      per_settlement_scale AS (
        SELECT psc.tx_hash, psc.log_index, psc.sum_baseline,
               csc.delta_usdc,
               CASE WHEN psc.sum_baseline > csc.delta_usdc AND psc.sum_baseline > 0
                    THEN csc.delta_usdc / psc.sum_baseline
                    ELSE 1::double precision
               END AS scale_factor
          FROM per_settlement_usdc_check psc
          LEFT JOIN channel_settlement_caps csc
            ON csc.tx_hash = psc.tx_hash AND csc.log_index = psc.log_index
      ),
      final_deltas AS (
        SELECT
          bd.tx_hash, bd.log_index, bd.channel_id, bd.service_id, bd.block_number, bd.timestamp, bd.day,
          bd.delta_amount_usdc_baseline * pss.scale_factor AS delta_amount_usdc,
          bd.delta_in_tokens, bd.delta_cached_in_tokens, bd.delta_out_tokens, bd.delta_requests
        FROM baseline_deltas bd
        LEFT JOIN per_settlement_scale pss
          ON pss.tx_hash = bd.tx_hash AND pss.log_index = bd.log_index
      ),

      cst_target AS (
        SELECT channel_id, service_id,
               SUM(delta_amount_usdc)      AS cumulative_amount_usdc,
               SUM(delta_in_tokens)        AS cumulative_in_tokens,
               SUM(delta_cached_in_tokens) AS cumulative_cached_in_tokens,
               SUM(delta_out_tokens)       AS cumulative_out_tokens,
               SUM(delta_requests)         AS cumulative_requests,
               MAX(block_number)           AS last_block,
               MAX(timestamp)              AS last_ts,
               (ARRAY_AGG(log_index ORDER BY block_number DESC, log_index DESC))[1] AS last_log_index
          FROM final_deltas
         GROUP BY channel_id, service_id
         HAVING SUM(delta_amount_usdc)      > 0
             OR SUM(delta_in_tokens)        > 0
             OR SUM(delta_cached_in_tokens) > 0
             OR SUM(delta_out_tokens)       > 0
             OR SUM(delta_requests)         > 0
      ),

      dsm_target AS (
        SELECT day, service_id,
               SUM(delta_amount_usdc)      AS delta_amount_usdc,
               SUM(delta_in_tokens)        AS delta_in_tokens,
               SUM(delta_cached_in_tokens) AS delta_cached_in_tokens,
               SUM(delta_out_tokens)       AS delta_out_tokens,
               SUM(delta_requests)         AS delta_requests
          FROM final_deltas
         GROUP BY day, service_id
         HAVING SUM(delta_amount_usdc)      > 0
             OR SUM(delta_in_tokens)        > 0
             OR SUM(delta_cached_in_tokens) > 0
             OR SUM(delta_out_tokens)       > 0
             OR SUM(delta_requests)         > 0
      ),

      cst_tombstone AS (
        DELETE FROM channel_service_totals cst
         USING lock
         WHERE lock.acquired
           AND NOT EXISTS (SELECT 1 FROM cst_target t
                            WHERE t.channel_id = cst.channel_id
                              AND t.service_id = cst.service_id)
        RETURNING 1
      ),

      dsm_tombstone AS (
        DELETE FROM daily_service_metrics dsm
         USING lock
         WHERE lock.acquired
           AND NOT EXISTS (SELECT 1 FROM dsm_target t
                            WHERE t.day = dsm.day AND t.service_id = dsm.service_id)
        RETURNING 1
      ),

      cst_publish AS (
        INSERT INTO channel_service_totals (channel_id, service_id,
          cumulative_amount_usdc, cumulative_in_tokens, cumulative_cached_in_tokens,
          cumulative_out_tokens, cumulative_requests,
          last_block, last_log_index, last_ts)
        SELECT t.channel_id, t.service_id,
               t.cumulative_amount_usdc, t.cumulative_in_tokens, t.cumulative_cached_in_tokens,
               t.cumulative_out_tokens, t.cumulative_requests,
               t.last_block, t.last_log_index, t.last_ts
          FROM cst_target t, lock
         WHERE lock.acquired
        ON CONFLICT (channel_id, service_id) DO UPDATE
          SET cumulative_amount_usdc      = EXCLUDED.cumulative_amount_usdc,
              cumulative_in_tokens        = EXCLUDED.cumulative_in_tokens,
              cumulative_cached_in_tokens = EXCLUDED.cumulative_cached_in_tokens,
              cumulative_out_tokens       = EXCLUDED.cumulative_out_tokens,
              cumulative_requests         = EXCLUDED.cumulative_requests,
              last_block                  = EXCLUDED.last_block,
              last_log_index              = EXCLUDED.last_log_index,
              last_ts                     = EXCLUDED.last_ts
        RETURNING 1
      )

    INSERT INTO daily_service_metrics (day, service_id,
      delta_amount_usdc, delta_in_tokens, delta_cached_in_tokens,
      delta_out_tokens, delta_requests)
    SELECT t.day, t.service_id,
           t.delta_amount_usdc, t.delta_in_tokens, t.delta_cached_in_tokens,
           t.delta_out_tokens, t.delta_requests
      FROM dsm_target t, lock
     WHERE lock.acquired
    ON CONFLICT (day, service_id) DO UPDATE
      SET delta_amount_usdc      = EXCLUDED.delta_amount_usdc,
          delta_in_tokens        = EXCLUDED.delta_in_tokens,
          delta_cached_in_tokens = EXCLUDED.delta_cached_in_tokens,
          delta_out_tokens       = EXCLUDED.delta_out_tokens,
          delta_requests         = EXCLUDED.delta_requests
  `);
}

// SPEC §5.6 — destructive global recompute, gated behind a hard env flag.
// TRUNCATEs every derived + source-of-truth table, resets settled events to
// 'pending', drains the backfill worker, then runs the rebuild.
export async function recomputeServiceMetadataAll(opts: {
  allowDestructive: boolean;
}): Promise<{ snapshotsBefore: number; snapshotsAfter: number }> {
  if (!opts.allowDestructive) {
    throw new Error("recomputeServiceMetadataAll refused: pass allowDestructive=true");
  }
  if (process.env.ALLOW_DESTRUCTIVE_RECOMPUTE !== "1") {
    throw new Error(
      "recomputeServiceMetadataAll refused: set ALLOW_DESTRUCTIVE_RECOMPUTE=1",
    );
  }

  const before = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM settlement_service_snapshots`,
  );

  await db.execute(sql`TRUNCATE settlement_service_snapshots`);
  await db.execute(sql`TRUNCATE channel_service_totals`);
  await db.execute(sql`TRUNCATE daily_service_metrics`);
  await db.execute(sql`
    UPDATE events SET metadata_decode_status = 'pending', metadata_decoded_at = NULL
     WHERE event_type = 'settled'
  `);

  // Drain the backfill. Page size mirrors the live cap; loop until empty so
  // the snapshot table is fully repopulated before the rebuild runs.
  while (true) {
    const n = await decodePendingMetadata(500);
    if (n === 0) break;
  }

  await recomputeServiceMetadata();

  const after = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM settlement_service_snapshots`,
  );

  return {
    snapshotsBefore: Number(before.rows[0]?.n ?? 0),
    snapshotsAfter: Number(after.rows[0]?.n ?? 0),
  };
}

// Re-export the decoded type so callers don't need to know about lib/metadata.
export type { DecodedMetadata } from "./metadata";
