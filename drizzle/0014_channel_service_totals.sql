CREATE TABLE IF NOT EXISTS "channel_service_totals" (
  "channel_id"                  text             NOT NULL,
  "service_id"                  text             NOT NULL,
  "cumulative_amount_usdc"      double precision NOT NULL,
  "cumulative_in_tokens"        bigint           NOT NULL,
  "cumulative_cached_in_tokens" bigint           NOT NULL,
  "cumulative_out_tokens"       bigint           NOT NULL,
  "cumulative_requests"         bigint           NOT NULL,
  "last_block"                  bigint           NOT NULL,
  "last_log_index"              integer          NOT NULL,
  "last_ts"                     bigint           NOT NULL,
  CONSTRAINT "channel_service_totals_pkey"
    PRIMARY KEY ("channel_id", "service_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cst_service_idx"
  ON "channel_service_totals" ("service_id");
