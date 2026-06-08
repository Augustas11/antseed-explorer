import type { Metadata } from "next";
import Link from "next/link";
import { listBuyers } from "@/lib/queries";
import { fmtNum, fmtUsd } from "@/lib/format";
import { calculateTrustScore, TRUST_SCORE_METHOD } from "@/lib/score";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TrustScore methodology | AntSeed Demand Explorer",
  description: "How AntFeed calculates buyer TrustScore from indexed AntSeed activity.",
};

export default async function ScorePage() {
  const [example] = await listBuyers({ limit: 1, qualifiedOnly: true, sort: "score" });
  const breakdown = example
    ? calculateTrustScore({
        address: example.address,
        totalSessions: example.total_sessions,
        totalSettledUsdc: example.total_settled_usdc,
        uniqueSellers: example.unique_sellers,
        ghostSessions: example.ghost_sessions,
      })
    : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">TrustScore methodology</h1>
        <p className="text-muted text-sm mt-2">
          TrustScore is a {TRUST_SCORE_METHOD.range.min}–{TRUST_SCORE_METHOD.range.max}
          {" "}buyer quality score computed from indexed AntSeed marketplace activity.
          A buyer is Qualified when <code className="font-mono">uniqueSellers &gt;= 3</code>.
        </p>
      </div>

      <section className="panel">
        <div className="px-4 py-3 border-b border-edge">
          <h2 className="font-medium">Inputs and weights</h2>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Input</th>
              <th>Weight</th>
              <th>Implementation</th>
            </tr>
          </thead>
          <tbody>
            {TRUST_SCORE_METHOD.components.map((component) => (
              <tr key={component.key}>
                <td>
                  <div className="text-ink">{component.label}</div>
                  <div className="text-xs text-muted font-mono">{component.input}</div>
                </td>
                <td>{component.max} pts</td>
                <td className="text-xs text-muted">{component.formula}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel p-4 space-y-3">
        <h2 className="font-medium">Worked example</h2>
        {example && breakdown ? (
          <>
            <p className="text-sm text-muted">
              An anonymized qualified buyer settled {fmtUsd(example.total_settled_usdc)}
              {" "}across {fmtNum(example.total_sessions)} sessions with
              {" "}{fmtNum(example.unique_sellers)} sellers and
              {" "}{fmtNum(example.ghost_sessions)} ghost sessions.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <ExampleStat label="Volume" value={breakdown.volume} />
              <ExampleStat label="Sessions" value={breakdown.consistency} />
              <ExampleStat label="Sellers" value={breakdown.diversity} />
              <ExampleStat label="Reliability" value={breakdown.reliability} />
              <ExampleStat label="Total" value={breakdown.total} />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">
            No qualified buyer is indexed yet, so no live worked example is available.
          </p>
        )}
      </section>

      <p className="text-xs text-muted">
        The scoring code is the source of truth for this page.{" "}
        <Link href="/buyers" className="text-accent hover:underline">
          Back to buyers →
        </Link>
      </p>
    </div>
  );
}

function ExampleStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-edge bg-bg p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}
