# Neon compute cut — antfeed.org

**Context.** July 2026 Neon bill (via Vercel Marketplace) was **$56.36 /
527.26 compute-hours** since Jul 1. Investigation traced ~all of it to the
single antfeed database (`ep-crimson-hall-aq6bfx9d`, us-east-1). No other
Vercel project is a live Neon consumer (krisskross = static, pearlrouter =
PGlite, antfleet-strategy / aeon-watch = no DB).

**Diagnosis.** 527 hrs ÷ 21 days = **~25 compute-hours/day**. This is NOT
query volume — the app uses the stateless Neon HTTP driver (`lib/db.ts`),
CDN-caches hot endpoints (`s-maxage=30–3600`), and the sync cron only holds
compute ~60s/tick (~0.4 hr/day). 25/day means the compute **never scales to
zero** and/or **preview branches** each hold an always-on endpoint. Classic
Vercel↔Neon idle leak.

## Code-side change (this branch)

- `vercel.json`: sync cron `0 * * * *` → `0 */3 * * *` (hourly → every 3h).
  Minor lever (~0.25 hr/day) but every fewer wake = more suspended time once
  scale-to-zero is on. Data freshness moves 1h → 3h; hot endpoints keep their
  own `s-maxage` cache so public UX is unaffected. Indexer is resumable, so a
  longer gap just drains a bigger batch next tick.

## Dashboard changes (where the money is — do these in Neon/Vercel console)

Ordered by impact. Items 1–2 are the actual bill killers.

1. **Scale-to-zero, suspend after 60s.** Neon console → Project → Branch →
   Edit compute → set autosuspend to the minimum (60s) on EVERY endpoint.
   Expected: idle ~25/day → ~1/day. Single biggest cut.
2. **Delete stale preview branches + stop auto-branching.** Neon → Branches:
   delete every branch that isn't `main`/production. In the Vercel Neon
   integration, disable "create a branch per preview deploy" (or set branches
   to expire/suspend). Each orphaned preview branch is its own compute meter.
3. **Pin autoscaling min 0.25 / max 1 CU** on the primary. This workload never
   needs more.
4. **Confirm pearlrouter has no Neon branch** of its own (it defaults to
   PGlite; keep it there).

**Endgame:** Neon's included allotment is ~190 compute-hrs/mo. With idle
killed, antfeed's real usage (cron + cached reads) lands under it → this bill
goes to ~$0, not just lower.

## Verify after the cut

Neon console → Monitoring / Billing → compute-hours should flatten to near the
cron/query floor within a day. Re-check the daily rate 48h after flipping
scale-to-zero.
