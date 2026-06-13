CREATE TABLE IF NOT EXISTS "daily_service_metrics" (
  "day"                    date             NOT NULL,
  "service_id"             text             NOT NULL,
  "delta_amount_usdc"      double precision NOT NULL DEFAULT 0,
  "delta_in_tokens"        bigint           NOT NULL DEFAULT 0,
  "delta_cached_in_tokens" bigint           NOT NULL DEFAULT 0,
  "delta_out_tokens"       bigint           NOT NULL DEFAULT 0,
  "delta_requests"         bigint           NOT NULL DEFAULT 0,
  CONSTRAINT "daily_service_metrics_pkey"
    PRIMARY KEY ("day", "service_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dsm_service_idx"
  ON "daily_service_metrics" ("service_id");
