CREATE TABLE IF NOT EXISTS "ants_holders" (
  "address" text PRIMARY KEY NOT NULL,
  "balance" numeric(78, 0) NOT NULL DEFAULT '0',
  "first_seen_block" bigint,
  "last_seen_block" bigint,
  "updated_at" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ants_holders_balance_idx" ON "ants_holders" ("balance");
