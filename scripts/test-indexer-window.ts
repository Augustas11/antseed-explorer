import assert from "node:assert/strict";
import {
  estimateBlockTimestamps,
  growLogBatchSize,
  shrinkLogBatchSize,
  syncEventStream,
} from "../lib/indexerWindow";

assert.equal(shrinkLogBatchSize(1n), 1n);
assert.equal(shrinkLogBatchSize(2n), 1n);
assert.equal(shrinkLogBatchSize(9n), 4n);
assert.equal(shrinkLogBatchSize(10n), 5n);
assert.equal(shrinkLogBatchSize(20n), 10n);
assert.equal(shrinkLogBatchSize(21n), 10n);
assert.equal(shrinkLogBatchSize(1000n), 500n);

assert.equal(growLogBatchSize(1n, 100n), 2n);
assert.equal(growLogBatchSize(50n, 100n), 100n);
assert.equal(growLogBatchSize(60n, 100n), 100n);
assert.equal(growLogBatchSize(100n, 100n), 100n);
assert.equal(growLogBatchSize(120n, 100n), 100n);

async function main() {
  const timestamps = await estimateBlockTimestamps({
    logs: [
      { blockNumber: 100n },
      { blockNumber: 98n },
      { blockNumber: 100n },
      { blockNumber: null },
    ],
    blockSeconds: 2,
    getBlockTimestamp: async (blockNumber) => {
      assert.equal(blockNumber, 100n);
      return 1_000n;
    },
  });

  assert.equal(timestamps.get(100n), 1_000);
  assert.equal(timestamps.get(98n), 996);
  assert.equal(timestamps.size, 2);

  const fallback = await estimateBlockTimestamps({
    logs: [{ blockNumber: 10n }, { blockNumber: 9n }],
    getBlockTimestamp: async () => {
      throw new Error("timestamp RPC failed");
    },
  });
  assert.equal(fallback.get(10n), 0);
  assert.equal(fallback.get(9n), 0);

  const stateWrites: string[] = [];
  const batches: string[] = [];
  const stream = await syncEventStream({
    fromBlockStart: 1n,
    head: 5n,
    initialBatchSize: 1n,
    maxBatchSize: 4n,
    cursorKey: "cursor",
    batchKey: "batch",
    deadlineMs: 10_000,
    sleepMs: 0,
    getLogs: async (fromBlock, toBlock) => [{ blockNumber: fromBlock, transactionHash: `0x${toBlock}` } as any],
    onLogs: async ({ from, to, logs }) => {
      batches.push(`${from}-${to}:${logs.length}`);
    },
    setStateValue: async (key, value) => {
      stateWrites.push(`${key}=${value}`);
    },
  });
  assert.deepEqual(stream, { ok: true, fromBlock: "1", toBlock: "5" });
  assert.deepEqual(batches, ["1-1:1", "2-2:1", "3-3:1", "4-4:1", "5-5:1"]);
  assert.ok(stateWrites.includes("cursor=5"));
  assert.ok(stateWrites.includes("batch=2"));

  const shrinkWrites: string[] = [];
  const shrinkBatches: string[] = [];
  let shrinkFailedOnce = false;
  const shrunk = await syncEventStream({
    fromBlockStart: 1n,
    head: 4n,
    initialBatchSize: 4n,
    maxBatchSize: 4n,
    cursorKey: "cursor",
    batchKey: "batch",
    deadlineMs: 10_000,
    sleepMs: 0,
    getLogs: async (fromBlock, toBlock) => {
      if (!shrinkFailedOnce) {
        shrinkFailedOnce = true;
        throw new Error("eth_getLogs block range too large");
      }
      return [{ blockNumber: fromBlock, transactionHash: `0x${toBlock}` } as any];
    },
    onLogs: async ({ from, to }) => {
      shrinkBatches.push(`${from}-${to}`);
    },
    setStateValue: async (key, value) => {
      shrinkWrites.push(`${key}=${value}`);
    },
  });
  assert.deepEqual(shrunk, { ok: true, fromBlock: "1", toBlock: "4" });
  assert.deepEqual(shrinkBatches, ["1-2", "3-4"]);
  assert.ok(shrinkWrites.includes("batch=2"));

  const deadline = await syncEventStream({
    fromBlockStart: 10n,
    head: 20n,
    initialBatchSize: 5n,
    maxBatchSize: 5n,
    cursorKey: "cursor",
    batchKey: "batch",
    deadlineMs: 0,
    sleepMs: 0,
    getLogs: async () => {
      throw new Error("should not fetch after deadline");
    },
    onLogs: async () => {
      throw new Error("should not map after deadline");
    },
    setStateValue: async () => {},
    now: () => 1,
    startedAt: 0,
  });
  assert.deepEqual(deadline, {
    ok: true,
    fromBlock: "10",
    toBlock: "10",
    error: "deadline_partial",
  });

  console.log("indexer window helper checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
