CREATE TABLE IF NOT EXISTS "api_keys" (
  "key" text PRIMARY KEY NOT NULL,
  "label" text,
  "created_at" bigint NOT NULL
);
