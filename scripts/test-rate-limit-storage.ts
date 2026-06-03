import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rateLimit = readFileSync("lib/rateLimit.ts", "utf8");
assert.match(rateLimit, /rateLimitBuckets/);
assert.match(rateLimit, /rate_limit_buckets/);
assert.doesNotMatch(
  rateLimit,
  /\bindexer_state\b/,
  "public rate limit counters must not share indexer_state storage",
);

const schema = readFileSync("lib/schema.ts", "utf8");
assert.match(schema, /export const rateLimitBuckets = pgTable/);
assert.match(schema, /"rate_limit_buckets"/);

const migration = readFileSync("drizzle/0010_add_rate_limit_buckets.sql", "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS "rate_limit_buckets"/);
assert.match(migration, /rate_limit_buckets_window_idx/);

const packageJson = readFileSync("package.json", "utf8");
assert.match(packageJson, /check:rate-limit-storage/);

const liveCheck = readFileSync("scripts/check-rate-limit-storage.ts", "utf8");
assert.match(liveCheck, /to_regclass\('public\.rate_limit_buckets'\)/);
assert.match(liveCheck, /to_regclass\('public\.rate_limit_buckets_window_idx'\)/);

console.log("Rate limit storage checks passed");
