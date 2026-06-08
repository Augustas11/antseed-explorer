CREATE INDEX IF NOT EXISTS "events_type_buyer_idx" ON "events" USING btree ("event_type","buyer_address");
