// Postgres (Neon) client + state helpers.
// The Neon HTTP driver is stateless and ideal for serverless/Vercel: each
// query is a single HTTP round-trip with no pool to manage. We lazy-init
// the client so `next build` can collect page data without a real DB.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { indexerState } from "./schema";

let _sql: NeonQueryFunction<false, false> | null = null;
let _db: NeonHttpDatabase<typeof schema> | null = null;

function init() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Configure it in your Vercel project Settings → Environment Variables, or in .env for local dev.",
    );
  }
  // fetchOptions: { cache: "no-store" } — Next.js 14's App Router caches
  // fetch() responses by default. Without this, Neon HTTP query results
  // get served from Next.js's fetch cache and the dashboard goes stale
  // even though the underlying Postgres data updated.
  _sql = neon(url, { fetchOptions: { cache: "no-store" } });
  _db = drizzle(_sql, { schema });
  return _db;
}

// Proxy so existing call sites (`db.select()`, `db.insert()`, etc.) still work.
// Lazy initialization happens on first property access.
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const real = init() as any;
    const v = real[prop];
    return typeof v === "function" ? v.bind(real) : v;
  },
});

export async function getState(key: string): Promise<string | null> {
  // Raw SQL — Drizzle's select+where on indexer_state returns empty rows on
  // some Neon/Drizzle version combos (likely "key" being a near-reserved word).
  const r = await init().execute<{ value: string }>(
    sql`SELECT value FROM indexer_state WHERE key = ${key} LIMIT 1`,
  );
  return r.rows[0]?.value ?? null;
}

export async function setState(key: string, value: string) {
  await init()
    .insert(indexerState)
    .values({ key, value })
    .onConflictDoUpdate({ target: indexerState.key, set: { value } });
}

// Atomic try-acquire: a single SQL statement that either claims the lock
// (existing value parses as an int older than `staleAfterMs`, or row absent)
// or returns nothing. Lets us safely run the indexer from cron + manual sync
// without racing on `last_indexed_block`.
const SYNC_LOCK_KEY = "indexer_running_at";

export async function tryAcquireSyncLock(staleAfterMs = 90_000): Promise<boolean> {
  const now = Date.now();
  const cutoff = now - staleAfterMs;
  // sql.raw inlines safe ints — see queries.ts for the same pattern under
  // Neon HTTP's binding quirks.
  const r = await init().execute<{ value: string }>(sql`
    INSERT INTO indexer_state (key, value)
    VALUES ('${sql.raw(SYNC_LOCK_KEY)}', '${sql.raw(String(now))}')
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value
      WHERE indexer_state.value ~ '^[0-9]+$'
        AND indexer_state.value::bigint < ${sql.raw(String(cutoff))}
    RETURNING value
  `);
  return r.rows.length > 0;
}

export async function releaseSyncLock() {
  await setState(SYNC_LOCK_KEY, "0");
}

export type DB = ReturnType<typeof init>;
