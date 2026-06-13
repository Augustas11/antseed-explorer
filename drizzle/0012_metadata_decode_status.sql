ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "metadata_decode_status" text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "metadata_decoded_at" bigint;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_metadata_decode_status_check'
  ) THEN
    ALTER TABLE "events"
      ADD CONSTRAINT "events_metadata_decode_status_check"
      CHECK ("metadata_decode_status" IN ('pending','empty','v1','v2','decode_failed'));
  END IF;
END$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_metadata_decode_pending_idx"
  ON "events" ("event_type", "block_number")
  WHERE "metadata_decode_status" = 'pending' AND "event_type" = 'settled';
