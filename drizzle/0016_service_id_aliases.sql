CREATE TABLE IF NOT EXISTS "service_id_aliases" (
  "service_id"    text   PRIMARY KEY,
  "raw_alias"     text   NOT NULL,
  "canonical_key" text   NOT NULL,
  "display"       text   NOT NULL,
  "first_seen_ts" bigint NOT NULL,
  "last_seen_ts"  bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sia_canonical_idx"
  ON "service_id_aliases" ("canonical_key");
