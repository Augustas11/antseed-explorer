import { unstable_cache } from "next/cache";
import { CONTRACTS } from "./antseed";
import { publicClient } from "./chain";

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const DEFAULT_EPOCH_ZERO_TS = 1_744_197_261; // AntseedChannels deployment timestamp, UTC.

const currentEpochAbi = [
  {
    type: "function",
    name: "currentEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const epochDurationAbi = [
  {
    type: "function",
    name: "epochDuration",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const upperEpochDurationAbi = [
  {
    type: "function",
    name: "EPOCH_DURATION",
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

function clampBigintNumber(value: bigint | number | null): number | null {
  if (value == null) return null;
  const n = typeof value === "bigint" ? Number(value) : value;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

async function readCurrentEpoch(): Promise<number | null> {
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

async function readEpochDuration(): Promise<number | null> {
  for (const address of [CONTRACTS.AntseedEmissions, CONTRACTS.AntseedStaking]) {
    try {
      const value = await publicClient.readContract({
        address,
        abi: epochDurationAbi,
        functionName: "epochDuration",
      });
      const n = clampBigintNumber(value);
      if (n != null && n > 0) return n;
    } catch {
      // Some contracts expose this as an uppercase constant.
    }
    try {
      const value = await publicClient.readContract({
        address,
        abi: upperEpochDurationAbi,
        functionName: "EPOCH_DURATION",
      });
      const n = clampBigintNumber(value);
      if (n != null && n > 0) return n;
    } catch {
      // Fall back below.
    }
  }
  return null;
}

function clockFromTime(durationSec: number, nowSec: number): EpochClock {
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
      console.warn(`[epoch] ${fallback.todo}`);
      return fallback;
    }

    const startTs = DEFAULT_EPOCH_ZERO_TS + contractEpoch * durationSec;
    return {
      currentEpoch: contractEpoch,
      startTs,
      endTs: startTs + durationSec,
      durationSec,
      source: duration == null ? "time-fallback" : "contract",
      todo:
        duration == null
          ? "TODO(epoch): current epoch read succeeded, but duration/start boundary reads are not indexed; using 7-day timestamp boundaries."
          : null,
    };
  },
  ["antfeed-epoch-clock"],
  { revalidate: 60 },
);
