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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Aborting.");
    process.exit(1);
  }

  const evCheck = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM events`);
  if ((evCheck.rows[0]?.n ?? 0) > 0) {
    console.error(
      `Postgres already has ${evCheck.rows[0]?.n} events. ` +
      `import-sqlite is a one-time backfill and must not be re-run on a non-empty database — ` +
      `it would overwrite live buyer_profiles with stale SQLite data.`
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
  const CHUNK = 500;
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
  console.log(`✓ done. Postgres now has ${ev.rows[0]?.n} events, ${bp.rows[0]?.n} buyers.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
