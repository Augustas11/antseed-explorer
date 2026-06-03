import { type Log } from "viem";
import { setState } from "./db";

function isRangeError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("block range") ||
    m.includes("10 block") ||
    m.includes("more than") ||
    m.includes("query returned more") ||
    m.includes("limit exceeded") ||
    (m.includes("eth_getlogs") && m.includes("range"))
  );
}

export function isRateLimitError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("compute units per second") ||
    m.includes("rate limit") ||
    m.includes("too many requests") ||
    m.includes("429")
  );
}

export function shrinkLogBatchSize(batchSize: bigint): bigint {
  if (batchSize <= 1n) return 1n;
  const next = batchSize / 2n;
  return next < 1n ? 1n : next;
}

export function growLogBatchSize(batchSize: bigint, maxBatchSize: bigint): bigint {
  if (maxBatchSize < 1n) return 1n;
  if (batchSize >= maxBatchSize) return maxBatchSize;
  const next = batchSize * 2n;
  return next > maxBatchSize ? maxBatchSize : next;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type AdaptiveLogFetchResult =
  | {
      kind: "logs";
      logs: Log[];
      to: bigint;
      batchSize: bigint;
      consecutiveSuccesses: number;
    }
  | {
      kind: "shrunk";
      to: bigint;
      batchSize: bigint;
      consecutiveSuccesses: number;
    }
  | {
      kind: "error";
      to: bigint;
      batchSize: bigint;
      consecutiveSuccesses: number;
      error: string;
    };

export async function fetchAdaptiveLogs(opts: {
  from: bigint;
  head: bigint;
  batchSize: bigint;
  batchKey: string;
  consecutiveSuccesses: number;
  getLogs: (fromBlock: bigint, toBlock: bigint) => Promise<Log[]>;
  setStateValue?: (key: string, value: string) => Promise<void>;
}): Promise<AdaptiveLogFetchResult> {
  const to =
    opts.from + opts.batchSize - 1n > opts.head
      ? opts.head
      : opts.from + opts.batchSize - 1n;
  let rateLimitRetries = 0;
  while (true) {
    try {
      const logs = await opts.getLogs(opts.from, to);
      return {
        kind: "logs",
        logs,
        to,
        batchSize: opts.batchSize,
        consecutiveSuccesses: opts.consecutiveSuccesses,
      };
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (isRangeError(msg) && opts.batchSize > 1n) {
        const nextBatchSize = shrinkLogBatchSize(opts.batchSize);
        await (opts.setStateValue ?? setState)(opts.batchKey, nextBatchSize.toString());
        return {
          kind: "shrunk",
          to,
          batchSize: nextBatchSize,
          consecutiveSuccesses: 0,
        };
      }
      if (isRateLimitError(msg) && rateLimitRetries < 3) {
        rateLimitRetries++;
        await sleep(1500 * rateLimitRetries);
        continue;
      }
      return {
        kind: "error",
        to,
        batchSize: opts.batchSize,
        consecutiveSuccesses: opts.consecutiveSuccesses,
        error: msg,
      };
    }
  }
}

export interface EventStreamBatch {
  from: bigint;
  to: bigint;
  logs: Log[];
}

export interface EventStreamResult {
  ok: boolean;
  fromBlock: string;
  toBlock: string;
  error?: string;
}

export async function syncEventStream(opts: {
  fromBlockStart: bigint;
  head: bigint;
  initialBatchSize: bigint;
  maxBatchSize: bigint;
  cursorKey: string;
  batchKey: string;
  deadlineMs: number;
  startedAt?: number;
  sleepMs?: number;
  growAfterSuccesses?: number;
  getLogs: (fromBlock: bigint, toBlock: bigint) => Promise<Log[]>;
  onLogs: (batch: EventStreamBatch) => Promise<void>;
  setStateValue?: (key: string, value: string) => Promise<void>;
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<EventStreamResult> {
  const setStateValue = opts.setStateValue ?? setState;
  const sleepFn = opts.sleepFn ?? sleep;
  const now = opts.now ?? Date.now;
  const startedAt = opts.startedAt ?? now();
  const sleepMs = opts.sleepMs ?? 150;
  const growAfterSuccesses = opts.growAfterSuccesses ?? 5;
  const cursor = { from: opts.fromBlockStart };
  let batchSize =
    opts.initialBatchSize > opts.maxBatchSize
      ? opts.maxBatchSize
      : opts.initialBatchSize;
  let consecutiveSuccesses = 0;

  while (cursor.from <= opts.head) {
    if (now() - startedAt > opts.deadlineMs) {
      return {
        ok: true,
        fromBlock: opts.fromBlockStart.toString(),
        toBlock: cursor.from.toString(),
        error: "deadline_partial",
      };
    }

    const fetched = await fetchAdaptiveLogs({
      from: cursor.from,
      head: opts.head,
      batchSize,
      batchKey: opts.batchKey,
      consecutiveSuccesses,
      getLogs: opts.getLogs,
      setStateValue,
    });
    batchSize = fetched.batchSize;
    consecutiveSuccesses = fetched.consecutiveSuccesses;
    if (fetched.kind === "shrunk") continue;
    if (fetched.kind === "error") {
      return {
        ok: false,
        fromBlock: cursor.from.toString(),
        toBlock: fetched.to.toString(),
        error: fetched.error,
      };
    }

    await opts.onLogs({ from: cursor.from, to: fetched.to, logs: fetched.logs });
    await setStateValue(opts.cursorKey, fetched.to.toString());
    consecutiveSuccesses += 1;
    if (consecutiveSuccesses >= growAfterSuccesses && batchSize < opts.maxBatchSize) {
      batchSize = growLogBatchSize(batchSize, opts.maxBatchSize);
      await setStateValue(opts.batchKey, batchSize.toString());
      consecutiveSuccesses = 0;
    }
    cursor.from = fetched.to + 1n;
    if (sleepMs > 0) await sleepFn(sleepMs);
  }

  return {
    ok: true,
    fromBlock: opts.fromBlockStart.toString(),
    toBlock: opts.head.toString(),
  };
}

export async function estimateBlockTimestamps(opts: {
  logs: Array<Pick<Log, "blockNumber">>;
  blockSeconds?: number;
  getBlockTimestamp: (blockNumber: bigint) => Promise<number | bigint>;
  rateLimitBackoffMs?: number;
}): Promise<Map<bigint, number>> {
  const uniqueBlocks = [
    ...new Set(opts.logs.map((log) => log.blockNumber).filter((b): b is bigint => !!b)),
  ];
  const blockTs = new Map<bigint, number>();
  if (uniqueBlocks.length === 0) return blockTs;

  const anchorBn = uniqueBlocks.reduce((a, b) => (b > a ? b : a));
  let anchorTs = 0;
  try {
    anchorTs = Number(await opts.getBlockTimestamp(anchorBn));
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (opts.rateLimitBackoffMs && isRateLimitError(msg)) {
      await sleep(opts.rateLimitBackoffMs);
    }
  }

  const blockSeconds = opts.blockSeconds ?? 2;
  for (const bn of uniqueBlocks) {
    const diff = Number(anchorBn - bn);
    blockTs.set(bn, anchorTs > 0 ? anchorTs - diff * blockSeconds : 0);
  }
  return blockTs;
}
