CREATE TABLE "buyer_profiles" (
	"address" text PRIMARY KEY NOT NULL,
	"total_sessions" integer DEFAULT 0 NOT NULL,
	"total_settled_usdc" double precision DEFAULT 0 NOT NULL,
	"unique_sellers" integer DEFAULT 0 NOT NULL,
	"ghost_sessions" integer DEFAULT 0 NOT NULL,
	"first_seen_block" bigint,
	"last_seen_block" bigint,
	"first_seen_ts" bigint,
	"last_seen_ts" bigint,
	"trust_score" double precision DEFAULT 0 NOT NULL,
	"qualified" boolean DEFAULT false NOT NULL,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"event_type" text NOT NULL,
	"buyer_address" text,
	"seller_address" text,
	"channel_id" text,
	"max_amount_usdc" double precision,
	"delta_usdc" double precision,
	"refund_usdc" double precision,
	"settled_amount_usdc" double precision,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"request_count" integer,
	"timestamp" bigint,
	"raw_log" text
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_directory" (
	"address" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"peer_id" text,
	"region" text,
	"trust_score" double precision,
	"services" text,
	"pricing" text,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE INDEX "buyer_score_idx" ON "buyer_profiles" USING btree ("trust_score");--> statement-breakpoint
CREATE INDEX "buyer_volume_idx" ON "buyer_profiles" USING btree ("total_settled_usdc");--> statement-breakpoint
CREATE UNIQUE INDEX "events_tx_log_uniq" ON "events" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "events_buyer_idx" ON "events" USING btree ("buyer_address");--> statement-breakpoint
CREATE INDEX "events_seller_idx" ON "events" USING btree ("seller_address");--> statement-breakpoint
CREATE INDEX "events_block_idx" ON "events" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "events_channel_idx" ON "events" USING btree ("channel_id");