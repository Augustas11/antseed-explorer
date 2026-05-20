-- Reset the AntseedDeposits indexer cursor so the next cron pass re-processes
-- all Deposited events from the deployment block and overwrites buyer_address
-- with tx.from (the real payer wallet) instead of the event's buyer parameter.
-- The ON CONFLICT DO UPDATE in syncAntseedDeposits handles the overwrite.
DELETE FROM indexer_state WHERE key = 'last_indexed_block_antseed_deposits';
