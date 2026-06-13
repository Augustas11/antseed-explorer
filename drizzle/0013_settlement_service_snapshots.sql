CREATE TABLE IF NOT EXISTS "settlement_service_snapshots" (
  "tx_hash"                     text             NOT NULL,
  "log_index"                   integer          NOT NULL,
  "channel_id"                  text             NOT NULL,
  "service_id"                  text             NOT NULL,
  "block_number"                bigint           NOT NULL,
  "timestamp"                   bigint           NOT NULL,
  "cumulative_amount_usdc"      double precision NOT NULL,
  "cumulative_in_tokens"        bigint           NOT NULL,
  "cumulative_cached_in_tokens" bigint           NOT NULL,
  "cumulative_out_tokens"       bigint           NOT NULL,
  "cumulative_requests"         bigint           NOT NULL,
  CONSTRAINT "settlement_service_snapshots_pkey"
    PRIMARY KEY ("tx_hash", "log_index", "service_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sss_service_idx"
  ON "settlement_service_snapshots" ("service_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sss_channel_svc_idx"
  ON "settlement_service_snapshots" ("channel_id", "service_id", "block_number", "log_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sss_ts_idx"
  ON "settlement_service_snapshots" ("timestamp");
