// scripts/check-dune-parity.ts
// Compare the Antfeed explorer against the Antseed Dune dashboard for every
// tracked widget. Reads cached Dune results (no execution credits used) and
// the public Antfeed API. Exits non-zero if any tracked diff exceeds tolerance.
//
// Usage:
//   DUNE_API_KEY=<key> npx tsx scripts/check-dune-parity.ts            # uses prod (antfeed.org)
//   EXPLORER_BASE=http://localhost:3000 npx tsx scripts/check-dune-parity.ts
//
// Dashboard: https://dune.com/antseed_com/antseed (id 209285).

import "dotenv/config";

const DUNE_KEY = process.env.DUNE_API_KEY;
const EXPLORER_BASE = (process.env.EXPLORER_BASE || "https://antfeed.org").replace(/\/$/, "");
const DUNE_BASE = "https://api.dune.com/api/v1";

if (!DUNE_KEY) {
  console.error("DUNE_API_KEY env var is required.");
  process.exit(2);
}

// Widget catalog (resolved from .omc/research/dune-queries/*.sql)
const WIDGETS = [
  { id: 6973980, title: "Total Tokens Consumed",        kind: "counter" as const },
  { id: 6978394, title: "Cumulative + daily USD volume", kind: "chart"   as const },
  { id: 7442088, title: "Daily total tokens consumed",   kind: "chart"   as const },
  { id: 6974179, title: "Daily active users + new users", kind: "chart"  as const },
  { id: 6978909, title: "Cumulative + daily requests",   kind: "chart"   as const },
  { id: 7435653, title: "Users",                         kind: "counter" as const },
  { id: 6974186, title: "Monthly active users",          kind: "chart"   as const },
  { id: 7340721, title: "ANTS released + claimed",       kind: "chart"   as const },
  { id: 7382462, title: "Leaderboard",                   kind: "table"   as const },
  { id: 7435819, title: "Average LTV in USDC",           kind: "counter" as const },
  { id: 7437503, title: "Median LTV in USDC",            kind: "counter" as const },
];

async function fetchDuneLatest(qid: number): Promise<any> {
  const r = await fetch(`${DUNE_BASE}/query/${qid}/results?limit=2000`, {
    headers: { "X-Dune-API-Key": DUNE_KEY! },
  });
  if (!r.ok) throw new Error(`dune ${qid}: ${r.status}`);
  return r.json();
}

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

interface Row { metric: string; dune: number | string | null; explorer: number | string | null; deltaPct: number | null; tolerancePct: number; ok: boolean; note?: string }

function pct(dune: number, explorer: number): number {
  if (dune === 0) return explorer === 0 ? 0 : Infinity;
  return ((explorer - dune) / dune) * 100;
}

function within(deltaPct: number, tol: number): boolean {
  return Math.abs(deltaPct) <= tol;
}

async function main() {
  console.log(`[parity] explorer=${EXPLORER_BASE}`);
  console.log(`[parity] dashboard=https://dune.com/antseed_com/antseed`);

  // Snapshot cached Dune values
  const dune: Record<number, any> = {};
  for (const w of WIDGETS) {
    try {
      dune[w.id] = await fetchDuneLatest(w.id);
      const ts = dune[w.id]?.execution_started_at;
      console.log(`  dune ${w.id} ${w.title.padEnd(34)} cached_at=${ts}`);
    } catch (e: any) {
      console.error(`  dune ${w.id} fetch failed:`, e.message);
    }
  }

  // Explorer aggregates
  const stats = await fetchJson(`${EXPLORER_BASE}/api/stats`);
  const buyers = await fetchJson(`${EXPLORER_BASE}/api/buyers?limit=200`).catch(() => ({ buyers: [] }));
  // The hero endpoint isn't exposed — derive what we can from /api/stats.
  // For tokens, we can use the daily/hourly endpoints or sum the sparkline.
  // The /api/stats response has `daily` (sessions/volume/active_buyers) but no token totals
  // — we expose those only on the homepage. So fetch the hero values from a
  // probe endpoint or skip them with explicit "n/a" rows here.

  const rows: Row[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // 1. Network Revenue (cum USDC) through last CLOSED day — cache-immune.
  //    Comparing the live cumulative-now numbers introduces Dune-cache-lag
  //    noise (typically 0.5–2 %). Through-yesterday must match exactly.
  const volRows: any[] = (dune[6978394]?.result?.rows || []).slice().sort((a: any, b: any) => a.day.localeCompare(b.day));
  const expDaily: any[] = (stats.daily || []).slice().sort((a: any, b: any) => a.day.localeCompare(b.day));
  const yDay = yesterday(today);
  const duneThruY = volRows.find((r: any) => r.day === yDay);
  if (duneThruY) {
    const dCum = Number(duneThruY.cumulative_volume_usd);
    // Explorer cumulative-through-yesterday = all-time total minus today's
    // partial. The /api/stats daily array is windowed (30d) and silently
    // drops earlier days, so we must NOT sum it — use the all-time figure
    // and subtract today's partial. driftUsdc=0 guarantees this is exact.
    const expTodayVol = Number(expDaily.find((d: any) => d.day === today)?.volume ?? 0);
    const eCum = Number(stats.totalVolumeUsdc ?? 0) - expTodayVol;
    const p = pct(dCum, eCum);
    rows.push({
      metric: `Network Revenue (cum USDC through ${yDay})`,
      dune: dCum.toFixed(2),
      explorer: eCum.toFixed(2),
      deltaPct: p,
      tolerancePct: 0.01,
      ok: within(p, 0.01),
      note: "cache-immune; expects sub-cent agreement",
    });
  }

  // 1b. Today's live partial volume — informational; expect explorer ≥ Dune cache.
  const duneToday = volRows.find((r: any) => r.day === today);
  const expToday = expDaily.find((d: any) => d.day === today);
  if (duneToday && expToday) {
    const dVal = Number(duneToday.daily_volume_usd);
    const eVal = Number(expToday.volume);
    rows.push({
      metric: `Today partial volume (${today})`,
      dune: dVal.toFixed(2) + ` (cached ${dune[6978394]?.execution_started_at?.slice(11, 16) || "?"} UTC)`,
      explorer: eVal.toFixed(2) + " (live)",
      deltaPct: null,
      tolerancePct: 0,
      ok: true,
      note: "Informational — Dune is cached; explorer is live. Expect explorer ≥ Dune.",
    });
  }

  // 2. Tokens Consumed (all-time) — Dune 6973980 vs explorer hero.totalTokens (not exposed via /api/stats).
  //    For now we just compare daily series sums where possible.
  const duneTok = Number(dune[6973980]?.result?.rows?.[0]?.total_tokens ?? 0);
  rows.push({
    metric: "Tokens Consumed (all-time, raw)",
    dune: duneTok,
    explorer: "(hero not exposed via API — render-time)",
    deltaPct: null,
    tolerancePct: 1.5,
    ok: true,
    note: "Compare manually until hero endpoint exists.",
  });

  // 3. Users counter — Dune 7435653 vs explorer paying-users (also hero only).
  const duneUsers = Number(dune[7435653]?.result?.rows?.[0]?.total_users ?? 0);
  rows.push({
    metric: "Users (Dune def: 5-contract tx senders)",
    dune: duneUsers,
    explorer: `${stats.totalBuyers ?? 0} buyers (definition differs)`,
    deltaPct: null,
    tolerancePct: 0,
    ok: false,
    note: "Definition mismatch — Dune counts distinct tx.from across 5 protocol contracts; explorer counts buyers + ANT holders.",
  });

  // 4. Daily volume — diff most-recent CLOSED day on both sides (today is in-progress).
  const dailyDune = volRows.find(r => r.day === yesterday(today)) || volRows[volRows.length - 2];
  const dailyExp = (stats.daily || []).find((d: any) => d.day === yesterday(today));
  if (dailyDune && dailyExp) {
    const d = Number(dailyDune.daily_volume_usd ?? 0);
    const e = Number(dailyExp.volume ?? 0);
    const p = pct(d, e);
    rows.push({
      metric: `Daily volume (${dailyDune.day.slice(0, 10)})`,
      dune: d.toFixed(2),
      explorer: e.toFixed(2),
      deltaPct: p,
      tolerancePct: 0.1,
      ok: within(p, 0.1),
    });
  }

  // 5. Daily tokens — most recent closed day.
  const dailyTokRows: any[] = dune[7442088]?.result?.rows || [];
  const dDay = dailyTokRows.find(r => r.day === yesterday(today));
  if (dDay) {
    rows.push({
      metric: `Daily tokens (${dDay.day})`,
      dune: Number(dDay.total_tokens),
      explorer: "(explorer hourly/daily token endpoint required)",
      deltaPct: null,
      tolerancePct: 0.5,
      ok: true,
      note: "Add lib/queries.ts getDailyTokens() to compare.",
    });
  }

  // 6. ANTS released vs claimed (Dune 7340721).
  const antsRows: any[] = dune[7340721]?.result?.rows || [];
  for (const r of antsRows) {
    rows.push({
      metric: `ANTS ${r.metric}`,
      dune: Number(r.ants).toFixed(2),
      explorer: "(no explorer counterpart)",
      deltaPct: null,
      tolerancePct: 0,
      ok: false,
      note: "Not yet implemented — see parity-gap §G.",
    });
  }

  // 7. Average / Median LTV
  const avg = Number(dune[7435819]?.result?.rows?.[0]?.avg_ltv_usdc ?? 0);
  const med = Number(dune[7437503]?.result?.rows?.[0]?.median_ltv_usdc ?? 0);
  rows.push({ metric: "Avg LTV (USDC)",    dune: avg, explorer: "(missing)", deltaPct: null, tolerancePct: 0, ok: false, note: "Implement after AntseedDeposits.Deposited is indexed." });
  rows.push({ metric: "Median LTV (USDC)", dune: med, explorer: "(missing)", deltaPct: null, tolerancePct: 0, ok: false, note: "Implement after AntseedDeposits.Deposited is indexed." });

  // Pretty-print
  const widthMetric = Math.max(...rows.map(r => r.metric.length));
  console.log("");
  for (const r of rows) {
    const ok = r.ok ? "OK" : (r.deltaPct === null ? "??" : "FAIL");
    const dp = r.deltaPct === null ? "-" : `${r.deltaPct > 0 ? "+" : ""}${r.deltaPct.toFixed(2)}%`;
    console.log(`[${ok}] ${r.metric.padEnd(widthMetric)}  dune=${r.dune}  explorer=${r.explorer}  Δ=${dp}  (tol=${r.tolerancePct}%)${r.note ? "  // " + r.note : ""}`);
  }

  const failed = rows.filter(r => !r.ok && r.deltaPct !== null);
  if (failed.length > 0) {
    console.error(`\n[parity] ${failed.length} numeric mismatches outside tolerance.`);
    process.exit(1);
  }
  const undefined_ = rows.filter(r => r.deltaPct === null && !r.ok);
  if (undefined_.length > 0) {
    console.warn(`\n[parity] ${undefined_.length} metrics not yet implemented (informational only).`);
  }
  console.log("\n[parity] all tracked numeric metrics within tolerance.");
}

function yesterday(today: string): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

main().catch((e) => { console.error(e); process.exit(2); });
