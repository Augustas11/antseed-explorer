import { scoreColor } from "@/lib/score";

export function ScoreBadge({ score, size = "sm" }: { score: number; size?: "sm" | "lg" }) {
  const c = scoreColor(score);
  const cls =
    c === "good" ? "badge-good" : c === "warn" ? "badge-warn" : "badge-bad";
  if (size === "lg") {
    return (
      <div
        className={`badge ${cls} text-3xl px-5 py-2 font-semibold tracking-tight`}
      >
        {score}
      </div>
    );
  }
  return <span className={`badge ${cls}`}>{score}</span>;
}

export function QualifiedBadge({ qualified }: { qualified: boolean }) {
  if (qualified) {
    return <span className="badge badge-good">✓ Qualified</span>;
  }
  return <span className="badge badge-muted">Not qualified</span>;
}
