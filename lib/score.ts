export interface BuyerProfile {
  address: string;
  totalSessions: number;
  totalSettledUsdc: number;
  uniqueSellers: number;
  ghostSessions: number;
}

export interface ScoreBreakdown {
  total: number;
  volume: number;
  consistency: number;
  diversity: number;
  reliability: number;
  qualified: boolean;
}

export function calculateTrustScore(p: BuyerProfile): ScoreBreakdown {
  // Volume (0–30): log scale, $100 USDC settled = 30 pts
  const volume = Math.min(
    30,
    (Math.log10(p.totalSettledUsdc + 1) / Math.log10(100)) * 30,
  );

  // Consistency (0–25): log scale, 50 sessions = 25 pts
  const consistency = Math.min(
    25,
    (Math.log10(p.totalSessions + 1) / Math.log10(50)) * 25,
  );

  // Diversity (0–25): <3 unique sellers = 0 (not Qualified). 3 = 10. 10+ = 25.
  const diversity =
    p.uniqueSellers < 3
      ? 0
      : Math.min(25, ((p.uniqueSellers - 3) / 7) * 15 + 10);

  // Reliability (0–20): penalise ghost sessions
  const totalAttempts = p.totalSessions + p.ghostSessions;
  const reliabilityRate =
    totalAttempts > 0 ? p.totalSessions / totalAttempts : 0;
  const reliability = reliabilityRate * 20;

  const total = Math.round(volume + consistency + diversity + reliability);

  return {
    total,
    volume: round1(volume),
    consistency: round1(consistency),
    diversity: round1(diversity),
    reliability: round1(reliability),
    qualified: p.uniqueSellers >= 3,
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function scoreColor(score: number): "good" | "warn" | "bad" {
  if (score >= 70) return "good";
  if (score >= 40) return "warn";
  return "bad";
}
