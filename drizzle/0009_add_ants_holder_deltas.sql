CREATE TABLE IF NOT EXISTS "ants_holder_deltas" (
  "tx_hash" text NOT NULL,
  "log_index" integer NOT NULL,
  "address" text NOT NULL,
  "delta_kind" text NOT NULL,
  "balance_delta" numeric(78, 0) NOT NULL DEFAULT '0',
  "staked_delta" numeric(78, 0) NOT NULL DEFAULT '0',
  "block_number" bigint NOT NULL,
  "updated_at" bigint,
  CONSTRAINT "ants_holder_deltas_tx_hash_log_index_address_delta_kind_pk"
    PRIMARY KEY("tx_hash", "log_index", "address", "delta_kind")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ants_holder_deltas_address_idx"
  ON "ants_holder_deltas" ("address");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ants_holder_deltas_block_idx"
  ON "ants_holder_deltas" ("block_number");
--> statement-breakpoint
INSERT INTO "ants_holder_deltas" (
  "tx_hash",
  "log_index",
  "address",
  "delta_kind",
  "balance_delta",
  "staked_delta",
  "block_number",
  "updated_at"
)
SELECT
  '__baseline__',
  0,
  "address",
  'baseline',
  "balance",
  "staked_balance",
  COALESCE("last_seen_block", "first_seen_block", 0),
  "updated_at"
FROM "ants_holders"
WHERE "balance" <> 0 OR "staked_balance" <> 0
ON CONFLICT DO NOTHING;
