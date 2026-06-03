CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
  "bucket_key" text PRIMARY KEY NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "window_start" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_buckets_window_idx" ON "rate_limit_buckets" USING btree ("window_start");
