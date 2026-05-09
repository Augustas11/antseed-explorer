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
  _sql = neon(url);
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

export type DB = ReturnType<typeof init>;
