ALTER TABLE "ants_holders" ADD COLUMN IF NOT EXISTS "staked_balance" numeric(78, 0) NOT NULL DEFAULT '0';
