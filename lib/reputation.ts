// On-chain trust score, computed locally from the `events` table to mirror
// AntSeed's canonical formula in
// github.com/antseed/antseed → packages/node/src/reputation/on-chain-reputation.ts
//
// We can replicate the multiplicative core (channels × volume × ticketBonus ×
// recencyGate × stakeGate) and the log-scale roll-up exactly. Two gaps versus
// the upstream node:
//   1. stakeGate — needs AntseedStaking events (not indexed here). All
//      providers in `provider_directory` have called `reserve()`, which requires
//      stake, so we default to 1.0. This is the documented fallback path.
//   2. Sybil risk — we compute `subfloor_ticket` from on-chain data; the
//      remaining flags (`burn_rate`, `narrow_custom`, `young_high_vol`) need
//      cross-peer routing context or stake age that we don't index.
//
// Range: 0–100 float. Returns null when the seller has no closed channels.

const ON_CHAIN_SCORE_LOG_CAP_EXPONENT = 7;
const SECONDS_PER_DAY = 86400;

export interface TrustInputs {
  closedCount: number;
  totalVolumeUsdc: number;
  lastSettledTs: number | null;
}

export interface TrustBreakdown {
  score: number;
  channels: number;
  volumeUsdc: number;
  avgTicketUsdc: number;
  ticketBonus: number;
  recencyGate: number;
  stakeGate: number;
  sybilRisk: number;
  baseScore: number;
  ageDays: number | null;
}

export function computeTrust(row: TrustInputs): TrustBreakdown | null {
  const channels = row.closedCount;
  if (channels <= 0) return null;
  const volume = row.totalVolumeUsdc;

  const avgTicket = volume / channels;
  const ticketBonus = Math.max(0.5, Math.min(1.5, avgTicket / 2));

  const nowSec = Date.now() / 1000;
  const ageSec = row.lastSettledTs != null ? nowSec - row.lastSettledTs : null;
  const ageDays = ageSec != null ? ageSec / SECONDS_PER_DAY : null;
  const recencyGate =
    ageDays == null ? 0 : ageDays < 14 ? 1.0 : ageDays < 60 ? 0.25 : 0;

  const stakeGate = 1.0;

  const trustRaw = channels * volume * ticketBonus * recencyGate * stakeGate;
  const baseScore = Math.min(
    100,
    (100 / ON_CHAIN_SCORE_LOG_CAP_EXPONENT) * Math.log10(1 + trustRaw),
  );

  // Sybil: subfloor_ticket only. Other flags require data we don't index.
  const sybilRisk = channels >= 50 && avgTicket < 1.0 ? 0.3 : 0;

  return {
    score: Math.max(0, baseScore * (1 - sybilRisk)),
    channels,
    volumeUsdc: volume,
    avgTicketUsdc: avgTicket,
    ticketBonus,
    recencyGate,
    stakeGate,
    sybilRisk,
    baseScore,
    ageDays,
  };
}

export function reputationBadge(score: number | null): {
  cls: string;
  label: string;
} {
  if (score == null) return { cls: "badge badge-muted", label: "new" };
  if (score >= 70) return { cls: "badge badge-good", label: "verified" };
  if (score >= 30) return { cls: "badge", label: "active" };
  return { cls: "badge badge-muted", label: "new" };
}

export function trustTooltip(b: TrustBreakdown | null): string {
  if (!b) return "No closed channels yet";
  const lines = [
    `Score: ${b.score.toFixed(1)}/100`,
    `Channels: ${b.channels}`,
    `Volume: $${b.volumeUsdc.toFixed(2)}`,
    `Avg ticket: $${b.avgTicketUsdc.toFixed(4)}`,
    `Ticket bonus: ${b.ticketBonus.toFixed(2)}×`,
    `Recency gate: ${b.recencyGate}× (${b.ageDays != null ? b.ageDays.toFixed(0) + "d" : "—"} since last settle)`,
    b.sybilRisk > 0 ? `Sybil penalty: -${(b.sybilRisk * 100).toFixed(0)}%` : null,
  ].filter(Boolean);
  return lines.join("\n");
}
