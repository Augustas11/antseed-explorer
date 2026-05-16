-- 0006: Track operator EVM address separately from the on-chain settler.
-- A peer in the directory may use a seller delegation contract: it settles
-- on AntseedChannels via a contract address that differs from its peerId-
-- derived operator address. We key `provider_directory.address` off the
-- settler (so the row joins to events.seller_address) and store the
-- operator here for display.

ALTER TABLE "provider_directory" ADD COLUMN IF NOT EXISTS "operator_address" text;
