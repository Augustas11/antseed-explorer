ALTER TABLE "events" ADD COLUMN "cumulative_amount_usdc" double precision;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "platform_fee_usdc" double precision;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "new_deposit_usdc" double precision;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "grace_period_end" bigint;--> statement-breakpoint
CREATE INDEX "events_timestamp_idx" ON "events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "events_type_ts_idx" ON "events" USING btree ("event_type","timestamp");
