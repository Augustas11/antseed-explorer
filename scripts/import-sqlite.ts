// One-shot importer: reads ./data/explorer.db (the old SQLite file) and
// pushes every row to the configured Postgres DATABASE_URL.
//
// NOT safe to re-run on a non-empty database: buyer_profiles and indexer_state
// use onConflictDoUpdate and would overwrite live indexed data with stale SQLite values.
// Events are safe (onConflictDoNothing), but buyer scores would be rolled back.
//
// Usage:
//   DATABASE_URL=postgres://… npx tsx scripts/import-sqlite.ts
//   DATABASE_URL=postgres://… SQLITE_PATH=./data/explorer.db npx tsx scripts/import-sqlite.ts

import "dotenv/config";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { db } from "../lib/db";
import {
  events as eventsTbl,
  buyerProfiles,
  providerDirectory,
  indexerState,
} from "../lib/schema";
import { sql } from "drizzle-orm";

const IMPORT_STATUS_KEY = "sqlite_import_status";
const CHUNK = 500;

interface TargetCounts {
  events: number;
  buyerProfiles: number;
  providerDirectory: number;
  indexerState: number;
}

async function tableCounts(): Promise<TargetCounts> {
  const r = await db.execute<{
    events: number;
    buyer_profiles: number;
    provider_directory: number;
    indexer_state: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM events) AS events,
      (SELECT COUNT(*)::int FROM buyer_profiles) AS buyer_profiles,
      (SELECT COUNT(*)::int FROM provider_directory) AS provider_directory,
      (SELECT COUNT(*)::int FROM indexer_state WHERE key <> ${IMPORT_STATUS_KEY}) AS indexer_state
  `);
  const row = r.rows[0];
  return {
    events: Number(row?.events ?? 0),
    buyerProfiles: Number(row?.buyer_profiles ?? 0),
    providerDirectory: Number(row?.provider_directory ?? 0),
    indexerState: Number(row?.indexer_state ?? 0),
  };
}

async function importStatus(): Promise<string | null> {
  const r = await db.execute<{ value: string }>(sql`
    SELECT value FROM indexer_state WHERE key = ${IMPORT_STATUS_KEY} LIMIT 1
  `);
  return r.rows[0]?.value ?? null;
}

async function setImportStatus(value: string) {
  await db
    .insert(indexerState)
    .values({ key: IMPORT_STATUS_KEY, value })
    .onConflictDoUpdate({
      target: indexerState.key,
      set: { value },
    });
}

function hasTargetRows(counts: TargetCounts): boolean {
  return counts.events > 0 ||
    counts.buyerProfiles > 0 ||
    counts.providerDirectory > 0 ||
    counts.indexerState > 0;
}

function statusAllowsResume(status: string | null): boolean {
  return status != null && status.startsWith("in_progress:");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Aborting.");
    process.exit(1);
  }

  const status = await importStatus();
  if (status?.startsWith("complete:")) {
    console.error(`SQLite import already completed (${status}). Refusing to re-run.`);
    process.exit(1);
  }

  const counts = await tableCounts();
  if (hasTargetRows(counts) && !statusAllowsResume(status)) {
    console.error(
      `Postgres is not empty: ` +
      `${counts.events} events, ${counts.buyerProfiles} buyers, ` +
      `${counts.providerDirectory} providers, ${counts.indexerState} state rows. ` +
      `import-sqlite is a one-time backfill and must not be re-run on a non-empty database — ` +
      `it would overwrite live data with stale SQLite values. ` +
      `Only a database marked ${IMPORT_STATUS_KEY}=in_progress:* may be resumed.`
    );
    process.exit(1);
  }

  const sqlitePath = path.resolve(process.env.SQLITE_PATH || "./data/explorer.db");
  if (!fs.existsSync(sqlitePath)) {
    console.error(`SQLite file not found at ${sqlitePath}`);
    process.exit(1);
  }

  const sdb = new Database(sqlitePath, { readonly: true });
  console.log(`Importing from ${sqlitePath} → ${process.env.DATABASE_URL.replace(/:[^@]*@/, ":***@")}`);
  if (statusAllowsResume(status)) {
    console.log(`Resuming interrupted SQLite import (${status}).`);
  } else {
    await setImportStatus(`in_progress:${new Date().toISOString()}`);
  }

  // ---- events ----
  const events = sdb
    .prepare(
      `SELECT tx_hash, log_index, block_number, event_type, buyer_address,
              seller_address, channel_id, max_amount_usdc, delta_usdc, refund_usdc,
              settled_amount_usdc, input_tokens, output_tokens, request_count,
              timestamp, raw_log FROM events`,
    )
    .all() as any[];
  console.log(`events: ${events.length}`);
  for (let i = 0; i < events.length; i += CHUNK) {
    const slice = events.slice(i, i + CHUNK).map((r) => ({
      txHash: r.tx_hash,
      logIndex: r.log_index,
      blockNumber: r.block_number,
      eventType: r.event_type,
      buyerAddress: r.buyer_address,
      sellerAddress: r.seller_address,
      channelId: r.channel_id,
      maxAmountUsdc: r.max_amount_usdc,
      deltaUsdc: r.delta_usdc,
      refundUsdc: r.refund_usdc,
      settledAmountUsdc: r.settled_amount_usdc,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      requestCount: r.request_count,
      timestamp: r.timestamp,
      rawLog: r.raw_log,
    }));
    await db.insert(eventsTbl).values(slice).onConflictDoNothing();
    process.stdout.write(`  ${Math.min(i + CHUNK, events.length)}/${events.length}\r`);
  }
  console.log();

  // ---- buyer_profiles ----
  const buyers = sdb.prepare(`SELECT * FROM buyer_profiles`).all() as any[];
  console.log(`buyer_profiles: ${buyers.length}`);
  for (const r of buyers) {
    await db
      .insert(buyerProfiles)
      .values({
        address: r.address,
        totalSessions: r.total_sessions,
        totalSettledUsdc: r.total_settled_usdc,
        uniqueSellers: r.unique_sellers,
        ghostSessions: r.ghost_sessions,
        firstSeenBlock: r.first_seen_block,
        lastSeenBlock: r.last_seen_block,
        firstSeenTs: r.first_seen_ts,
        lastSeenTs: r.last_seen_ts,
        trustScore: r.trust_score,
        qualified: !!r.qualified,
        updatedAt: r.updated_at,
      })
      .onConflictDoUpdate({
        target: buyerProfiles.address,
        set: {
          totalSessions: r.total_sessions,
          totalSettledUsdc: r.total_settled_usdc,
          uniqueSellers: r.unique_sellers,
          ghostSessions: r.ghost_sessions,
          firstSeenBlock: r.first_seen_block,
          lastSeenBlock: r.last_seen_block,
          firstSeenTs: r.first_seen_ts,
          lastSeenTs: r.last_seen_ts,
          trustScore: r.trust_score,
          qualified: !!r.qualified,
          updatedAt: r.updated_at,
        },
      });
  }

  // ---- provider_directory ----
  const providers = sdb.prepare(`SELECT * FROM provider_directory`).all() as any[];
  console.log(`provider_directory: ${providers.length}`);
  for (const r of providers) {
    await db
      .insert(providerDirectory)
      .values({
        address: r.address,
        displayName: r.display_name,
        peerId: r.peer_id,
        region: r.region,
        trustScore: r.trust_score,
        services: r.services,
        pricing: r.pricing,
        updatedAt: r.updated_at,
      })
      .onConflictDoUpdate({
        target: providerDirectory.address,
        set: {
          displayName: r.display_name,
          peerId: r.peer_id,
          region: r.region,
          trustScore: r.trust_score,
          services: r.services,
          pricing: r.pricing,
          updatedAt: r.updated_at,
        },
      });
  }

  // ---- indexer_state ----
  const states = sdb.prepare(`SELECT key, value FROM indexer_state`).all() as any[];
  console.log(`indexer_state: ${states.length}`);
  for (const r of states) {
    await db
      .insert(indexerState)
      .values({ key: r.key, value: r.value })
      .onConflictDoUpdate({ target: indexerState.key, set: { value: r.value } });
  }

  // sanity check
  const ev = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM events`);
  const bp = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM buyer_profiles`);
  await setImportStatus(`complete:${new Date().toISOString()}:events=${ev.rows[0]?.n ?? 0}:buyers=${bp.rows[0]?.n ?? 0}`);
  sdb.close();
  console.log(`✓ done. Postgres now has ${ev.rows[0]?.n} events, ${bp.rows[0]?.n} buyers.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
