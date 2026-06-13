// Decoder for the SpendingAuth metadata payload emitted in
// AntseedChannels.ChannelSettled (the `bytes metadata` field already captured
// in events.raw_log). v1 is the legacy 4-field aggregate; v2 (AntSeed v0.1.103
// / PR #653) adds a ServiceTotal[] tail with per-service cumulative counters.
//
// SPEC §5.2. Try v2 first, fall back to v1, never throw — return a
// `{version: null, reason}` shape for empty / garbage so callers can
// distinguish.

import { decodeAbiParameters, keccak256, stringToBytes } from "viem";

export const SERVICE_TUPLE = {
  type: "tuple[]",
  components: [
    { name: "serviceId", type: "bytes32" },
    { name: "cumulativeAmount", type: "uint256" },
    { name: "cumulativeInputTokens", type: "uint256" },
    { name: "cumulativeCachedInputTokens", type: "uint256" },
    { name: "cumulativeOutputTokens", type: "uint256" },
    { name: "cumulativeRequestCount", type: "uint256" },
  ],
} as const;

export const V1_PARAMS = [
  { name: "version", type: "uint256" },
  { name: "cumIn", type: "uint256" },
  { name: "cumOut", type: "uint256" },
  { name: "cumReq", type: "uint256" },
] as const;

export const V2_PARAMS = [
  { name: "version", type: "uint256" },
  { name: "cumIn", type: "uint256" },
  { name: "cumOut", type: "uint256" },
  { name: "cumReq", type: "uint256" },
  { name: "services", ...SERVICE_TUPLE },
] as const;

export interface DecodedService {
  serviceId: `0x${string}`;
  cumulativeAmount: bigint;
  cumulativeInputTokens: bigint;
  cumulativeCachedInputTokens: bigint;
  cumulativeOutputTokens: bigint;
  cumulativeRequestCount: bigint;
}

export type DecodedMetadata =
  | { version: 1; cumIn: bigint; cumOut: bigint; cumReq: bigint }
  | {
      version: 2;
      cumIn: bigint;
      cumOut: bigint;
      cumReq: bigint;
      services: DecodedService[];
    }
  | { version: null; reason: "empty" | "decode_failed" };

export type TerminalStatus = "empty" | "v1" | "v2" | "decode_failed";

export function terminalStatusOf(decoded: DecodedMetadata): TerminalStatus {
  if (decoded.version === 2) return "v2";
  if (decoded.version === 1) return "v1";
  return decoded.reason === "empty" ? "empty" : "decode_failed";
}

// Bounds for adversarial payloads. A buyer-signed `SpendingAuth.metadata`
// blob arrives over an attacker-controlled path (buyer crafts → seller relays
// → ChannelSettled.metadata bytes). We need ceilings everywhere a large
// number could blow up memory, query cost, or destination columns.
//
// 64 KiB is well above the largest realistic v2 payload (a few hundred
// services at ~200 bytes each) but small enough that `decodeAbiParameters`
// can't be DoS'd by an MB-scale tail.
const MAX_METADATA_BYTES = 64 * 1024;
// Postgres bigint is signed 64-bit. Counters from v2 payloads land in
// settlement_service_snapshots.cumulative_*_tokens (bigint). Reject anything
// above this so an INSERT can't fail mid-batch and leave the row pending
// forever; reject negative values defensively even though uint256 is unsigned.
const MAX_PG_BIGINT = 9_223_372_036_854_775_807n;
// Reject obviously-malformed payloads where one row claims billions of
// services. Real payloads are ~5-50 services per channel.
const MAX_DECODED_SERVICES = 1024;

function safeBigint(value: bigint): bigint {
  if (value < 0n || value > MAX_PG_BIGINT) {
    throw new Error("counter out of safe bigint range");
  }
  return value;
}

export function decodeMetadata(bytes: string | null | undefined): DecodedMetadata {
  if (!bytes || bytes === "0x") return { version: null, reason: "empty" };
  const hex = (bytes.startsWith("0x") ? bytes : `0x${bytes}`) as `0x${string}`;
  // Cap byte length BEFORE handing to decodeAbiParameters so a 100 MB blob
  // can't blow the heap. Length is in hex chars; each byte = 2 chars.
  if (hex.length - 2 > MAX_METADATA_BYTES * 2) {
    return { version: null, reason: "decode_failed" };
  }

  try {
    const [version, cumIn, cumOut, cumReq, services] = decodeAbiParameters(
      V2_PARAMS,
      hex,
    ) as readonly [bigint, bigint, bigint, bigint, readonly DecodedService[]];
    if (version === 2n) {
      // Hard ceiling on services.length — a malformed payload with billions
      // of entries can't be coalesced even if decodeAbiParameters returned.
      if (services.length > MAX_DECODED_SERVICES) {
        return { version: null, reason: "decode_failed" };
      }
      // Validate every counter is in the bigint-safe range BEFORE we ingest.
      // Catching here means applyDecodedSettlement never has to handle the
      // out-of-range case — bad rows get terminally marked decode_failed.
      try {
        for (const s of services) {
          safeBigint(s.cumulativeAmount);
          safeBigint(s.cumulativeInputTokens);
          safeBigint(s.cumulativeCachedInputTokens);
          safeBigint(s.cumulativeOutputTokens);
          safeBigint(s.cumulativeRequestCount);
        }
        safeBigint(cumIn);
        safeBigint(cumOut);
        safeBigint(cumReq);
      } catch {
        return { version: null, reason: "decode_failed" };
      }
      // Coalesce duplicate serviceIds: take max of each counter independently
      // so a malformed payload where one duplicate has higher cumulativeAmount
      // and another has higher cumulativeOutputTokens cannot silently drop
      // either (SPEC §5.2, pass-9 #2, pass-8 #4).
      const byId = new Map<string, DecodedService>();
      const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);
      for (const s of services) {
        const k = s.serviceId.toLowerCase() as `0x${string}`;
        const prior = byId.get(k);
        if (!prior) {
          byId.set(k, { ...s, serviceId: k });
        } else {
          byId.set(k, {
            serviceId: k,
            cumulativeAmount: maxBig(s.cumulativeAmount, prior.cumulativeAmount),
            cumulativeInputTokens: maxBig(
              s.cumulativeInputTokens,
              prior.cumulativeInputTokens,
            ),
            cumulativeCachedInputTokens: maxBig(
              s.cumulativeCachedInputTokens,
              prior.cumulativeCachedInputTokens,
            ),
            cumulativeOutputTokens: maxBig(
              s.cumulativeOutputTokens,
              prior.cumulativeOutputTokens,
            ),
            cumulativeRequestCount: maxBig(
              s.cumulativeRequestCount,
              prior.cumulativeRequestCount,
            ),
          });
        }
      }
      return { version: 2, cumIn, cumOut, cumReq, services: [...byId.values()] };
    }
  } catch {
    // Fall through to v1 attempt.
  }

  try {
    const [version, cumIn, cumOut, cumReq] = decodeAbiParameters(
      V1_PARAMS,
      hex,
    ) as readonly [bigint, bigint, bigint, bigint];
    if (version === 1n) {
      try {
        safeBigint(cumIn);
        safeBigint(cumOut);
        safeBigint(cumReq);
      } catch {
        return { version: null, reason: "decode_failed" };
      }
      return { version: 1, cumIn, cumOut, cumReq };
    }
  } catch {
    // Fall through to decode_failed.
  }

  return { version: null, reason: "decode_failed" };
}

// stringToBytes() forces UTF-8 path so that a service-name string like
// "0xdeadbeef" hashes correctly. viem.toBytes() would re-parse a hex-looking
// input as bytes and silently produce the wrong hash (SPEC §5.2, pass-1 #9).
export function serviceIdOf(raw: string): `0x${string}` {
  return keccak256(stringToBytes(raw.trim()));
}

// USDC scaling: per-service cumulativeAmount is uint256 in 6-decimal units.
// At current Base volumes a channel-service cumulative stays well under
// Number.MAX_SAFE_INTEGER / 1e6 (~9e9 USDC), so a direct Number divide is
// safe. SPEC §5.2.
export function usdcFromAmount(cumulativeAmount: bigint): number {
  return Number(cumulativeAmount) / 1_000_000;
}
