import { unstable_cache } from "next/cache";
import { CONTRACTS } from "./antseed";
import { publicClient } from "./chain";
import { getLatestClaimedEpochAnchor } from "./queries";

export const SEVEN_DAYS = 7 * 24 * 60 * 60;
// Last-resort calibration: currentEpoch() returned 8 on 2026-06-08 and the
// observed network clock put epoch 8 ending around 2026-06-11 UTC.
export const DEFAULT_EPOCH_ZERO_TS = 1_775_692_800; // 2026-04-09T00:00:00Z.
const MIN_SANE_EPOCH_TS = 1_735_689_600; // 2025-01-01T00:00:00Z.
const MAX_EPOCH_DURATION_SEC = 366 * 24 * 60 * 60;

export const EPOCH_DURATION_PROBES = [
  "epochDuration",
  "EPOCH_DURATION",
  "epochLength",
] as const;

export const EPOCH_ZERO_TIMESTAMP_PROBES = [
  "startTime",
  "genesisTimestamp",
  "epochStart",
] as const;

export const EPOCH_START_BY_NUMBER_PROBES = [
  "epochStart",
  "epochs",
] as const;

let calibrationWarningWindow = -1;

const currentEpochAbi = [
  {
    type: "function",
    name: "currentEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type EpochSource = "contract" | "time-fallback";

export interface EpochClock {
  currentEpoch: number;
  startTs: number;
  endTs: number;
  durationSec: number;
  source: EpochSource;
  todo: string | null;
}

interface EpochBoundary {
  startTs: number;
  endTs: number;
  durationSec: number;
  todo: string | null;
}

function clampBigintNumber(value: bigint | number | null): number | null {
  if (value == null) return null;
  const n = typeof value === "bigint" ? Number(value) : value;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function emptyUint256Abi<Name extends string>(name: Name) {
  return [
    {
      type: "function",
      name,
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "uint256" }],
    },
  ] as const;
}

function epochNumberUint256Abi<Name extends string>(name: Name) {
  return [
    {
      type: "function",
      name,
      stateMutability: "view",
      inputs: [{ name: "epoch", type: "uint256" }],
      outputs: [{ name: "", type: "uint256" }],
    },
  ] as const;
}

const epochsTupleAbi = [
  {
    type: "function",
    name: "epochs",
    stateMutability: "view",
    inputs: [{ name: "epoch", type: "uint256" }],
    outputs: [
      { name: "start", type: "uint256" },
      { name: "end", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "claimed", type: "uint256" },
    ],
  },
] as const;

function firstUint256(value: unknown): number | null {
  const direct = typeof value === "bigint" || typeof value === "number" ? clampBigintNumber(value) : null;
  if (direct != null) return direct;
  if (Array.isArray(value)) {
    return clampBigintNumber(value[0] as bigint | number | null);
  }
  if (typeof value === "object" && value !== null && "start" in value) {
    return clampBigintNumber((value as { start?: bigint | number | null }).start ?? null);
  }
  return null;
}

function isSaneDuration(durationSec: number | null): durationSec is number {
  return durationSec != null && durationSec > 0 && durationSec <= MAX_EPOCH_DURATION_SEC;
}

function isSaneTimestamp(ts: number | null, nowSec: number): ts is number {
  return ts != null && ts >= MIN_SANE_EPOCH_TS && ts <= nowSec + MAX_EPOCH_DURATION_SEC;
}

function isCurrentBoundary(boundary: EpochBoundary, nowSec: number): boolean {
  return (
    isSaneDuration(boundary.durationSec) &&
    isSaneTimestamp(boundary.startTs, nowSec) &&
    isSaneTimestamp(boundary.endTs, nowSec) &&
    boundary.endTs > boundary.startTs &&
    boundary.startTs <= nowSec &&
    boundary.endTs > nowSec
  );
}

function boundaryFromEpochZero(
  epochZeroTs: number,
  currentEpoch: number,
  durationSec: number,
  nowSec: number,
  todo: string | null,
): EpochBoundary | null {
  const startTs = epochZeroTs + currentEpoch * durationSec;
  const boundary = { startTs, endTs: startTs + durationSec, durationSec, todo };
  return isCurrentBoundary(boundary, nowSec) ? boundary : null;
}

export async function readCurrentEpoch(): Promise<number | null> {
  for (const address of [CONTRACTS.AntseedEmissions, CONTRACTS.AntseedStaking]) {
    try {
      const value = await publicClient.readContract({
        address,
        abi: currentEpochAbi,
        functionName: "currentEpoch",
      });
      const n = clampBigintNumber(value);
      if (n != null) return n;
    } catch {
      // Try the next known rewards/staking contract.
    }
  }
  return null;
}

async function readEmptyUint256Function(
  address: `0x${string}`,
  functionName: (typeof EPOCH_DURATION_PROBES)[number] | (typeof EPOCH_ZERO_TIMESTAMP_PROBES)[number],
): Promise<number | null> {
  const value: unknown = await publicClient.readContract({
    address,
    abi: emptyUint256Abi(functionName),
    functionName,
  });
  return firstUint256(value);
}

async function readEpochStartByNumber(
  functionName: (typeof EPOCH_START_BY_NUMBER_PROBES)[number],
  epoch: number,
): Promise<number | null> {
  const value: unknown = await publicClient.readContract({
    address: CONTRACTS.AntseedEmissions,
    abi: functionName === "epochs" ? epochsTupleAbi : epochNumberUint256Abi(functionName),
    functionName,
    args: [BigInt(epoch)],
  });
  return firstUint256(value);
}

export async function readEpochDuration(): Promise<number | null> {
  for (const address of [CONTRACTS.AntseedEmissions, CONTRACTS.AntseedStaking]) {
    for (const functionName of EPOCH_DURATION_PROBES) {
      try {
        const n = await readEmptyUint256Function(address, functionName);
        if (isSaneDuration(n)) return n;
      } catch {
        // Continue probing known epoch-duration spellings.
      }
    }
  }
  return null;
}

export function clockFromTime(durationSec: number, nowSec: number): EpochClock {
  const currentEpoch = Math.max(0, Math.floor((nowSec - DEFAULT_EPOCH_ZERO_TS) / durationSec));
  const startTs = DEFAULT_EPOCH_ZERO_TS + currentEpoch * durationSec;
  return {
    currentEpoch,
    startTs,
    endTs: startTs + durationSec,
    durationSec,
    source: "time-fallback",
    todo: "TODO(epoch): replace 7-day timestamp epochs with explicit indexed reward epoch boundaries when contract ABI support is available.",
  };
}

async function readContractBoundary(
  currentEpoch: number,
  durationSec: number | null,
  nowSec: number,
): Promise<EpochBoundary | null> {
  for (const functionName of EPOCH_START_BY_NUMBER_PROBES) {
    try {
      const startTs = await readEpochStartByNumber(functionName, currentEpoch);
      const nextStartTs = await readEpochStartByNumber(functionName, currentEpoch + 1);
      if (isSaneTimestamp(startTs, nowSec) && isSaneTimestamp(nextStartTs, nowSec)) {
        const boundary = {
          startTs,
          endTs: nextStartTs,
          durationSec: nextStartTs - startTs,
          todo: null,
        };
        if (isCurrentBoundary(boundary, nowSec)) return boundary;
      }
      if (isSaneTimestamp(startTs, nowSec) && durationSec != null) {
        const boundary = {
          startTs,
          endTs: startTs + durationSec,
          durationSec,
          todo: null,
        };
        if (isCurrentBoundary(boundary, nowSec)) return boundary;
      }
    } catch {
      // Continue probing known indexed epoch-boundary spellings.
    }
  }

  for (const functionName of EPOCH_ZERO_TIMESTAMP_PROBES) {
    try {
      const timestamp = await readEmptyUint256Function(CONTRACTS.AntseedEmissions, functionName);
      if (!isSaneTimestamp(timestamp, nowSec)) continue;

      const assumedDuration = durationSec ?? SEVEN_DAYS;
      const todo =
        durationSec == null
          ? "TODO(epoch): contract exposed an epoch timestamp but no duration; using 7-day timestamp boundaries."
          : null;
      const currentStartBoundary = {
        startTs: timestamp,
        endTs: timestamp + assumedDuration,
        durationSec: assumedDuration,
        todo,
      };
      if (isCurrentBoundary(currentStartBoundary, nowSec)) return currentStartBoundary;

      const epochZeroBoundary = boundaryFromEpochZero(
        timestamp,
        currentEpoch,
        assumedDuration,
        nowSec,
        todo,
      );
      if (epochZeroBoundary) return epochZeroBoundary;
    } catch {
      // Continue probing known genesis/start-time spellings.
    }
  }

  return null;
}

async function readIndexedClaimBoundary(
  currentEpoch: number,
  durationSec: number,
  nowSec: number,
): Promise<EpochBoundary | null> {
  const anchor = await getLatestClaimedEpochAnchor();
  if (anchor == null) return null;
  const epochZeroTs = anchor.timestamp - (anchor.epoch + 1) * durationSec;
  return boundaryFromEpochZero(
    epochZeroTs,
    currentEpoch,
    durationSec,
    nowSec,
    "TODO(epoch): contract epoch boundary reads are unavailable; using indexed claim timestamps with 7-day epoch boundaries.",
  );
}

function warnCalibrationFallback(clock: EpochClock, reason: string) {
  const window = Math.floor(Date.now() / 60_000);
  if (calibrationWarningWindow === window) return;
  calibrationWarningWindow = window;
  console.warn(
    `[epoch] using calibrated fallback anchor ${DEFAULT_EPOCH_ZERO_TS} (${new Date(
      DEFAULT_EPOCH_ZERO_TS * 1000,
    ).toISOString()}); ${reason}; currentEpoch=${clock.currentEpoch}; startTs=${clock.startTs}; endTs=${clock.endTs}`,
  );
}

export const getEpochClock = unstable_cache(
  async (): Promise<EpochClock> => {
    const nowSec = Math.floor(Date.now() / 1000);
    const [contractEpoch, duration] = await Promise.all([
      readCurrentEpoch(),
      readEpochDuration(),
    ]);
    const durationSec = duration ?? SEVEN_DAYS;

    if (contractEpoch == null) {
      const fallback = clockFromTime(durationSec, nowSec);
      warnCalibrationFallback(fallback, "currentEpoch() was unavailable");
      return fallback;
    }

    const contractBoundary = await readContractBoundary(contractEpoch, duration, nowSec);
    if (contractBoundary) {
      return {
        currentEpoch: contractEpoch,
        startTs: contractBoundary.startTs,
        endTs: contractBoundary.endTs,
        durationSec: contractBoundary.durationSec,
        source: "contract",
        todo: contractBoundary.todo,
      };
    }

    const indexedClaimBoundary = await readIndexedClaimBoundary(contractEpoch, durationSec, nowSec);
    if (indexedClaimBoundary) {
      return {
        currentEpoch: contractEpoch,
        startTs: indexedClaimBoundary.startTs,
        endTs: indexedClaimBoundary.endTs,
        durationSec: indexedClaimBoundary.durationSec,
        source: duration == null ? "time-fallback" : "contract",
        todo:
          duration == null
            ? indexedClaimBoundary.todo
            : "TODO(epoch): contract epoch boundary reads are unavailable; using indexed claim timestamps.",
      };
    }

    const fallback = clockFromTime(durationSec, nowSec);
    warnCalibrationFallback(
      fallback,
      "contract boundary probes and indexed claim anchor were unavailable",
    );
    return {
      currentEpoch: contractEpoch,
      startTs: fallback.startTs,
      endTs: fallback.endTs,
      durationSec,
      source: duration == null ? "time-fallback" : "contract",
      todo:
        duration == null
          ? "TODO(epoch): current epoch read succeeded, but duration/start boundary reads are not indexed; using 7-day timestamp boundaries."
          : "TODO(epoch): contract duration read succeeded, but start boundary reads are unavailable; using calibrated epoch-zero timestamp.",
    };
  },
  ["antfeed-epoch-clock"],
  { revalidate: 60 },
);
