// Render a Signal as a markdown card the writer can turn into a post.
//
// Voice: "The Colony Scout" — the established @AntFeed X persona.
//   - all lowercase except token symbols, addresses, proper-noun handles
//   - one fact per line, line-break separated, no paragraphs
//   - periods end every line; no commas-as-pause; no semicolons
//   - no emojis, no hashtags, no exclamation marks
//   - em-dashes allowed, sparingly, for inline qualification
//   - third-person observer ("the colony", "the scout", "the hive")
//   - closing aphoristic stinger when the data invites it
//   - CTA = bare arrow + URL on its own line: `→ antfeed.org/...`
//   - ~140 char budget when non-premium; trim ruthlessly
//   - banned: "ghost"/"ghosts" (use "unsettled" / "closure" / "no settlement")
//   - banned corporate verbs: excited/thrilled/leveraging/unlock/amazing/huge
//
// Full rules + ground-truth exemplars live in the internal AntFeed Colony
// Scout voice rules.

import type { Signal } from "./types";

export interface RenderedCard {
  filename: string;
  body: string;
}

export function renderCard(signal: Signal): RenderedCard {
  const day = isoDay(signal.occurredAt);
  const filename = `${day}-${signal.kind}-${slug(signal.key)}.md`;
  const body = buildBody(signal, day);
  return { filename, body };
}

function buildBody(s: Signal, day: string): string {
  const facts = Object.entries(s.facts)
    .map(([k, v]) => `- **${k}:** ${formatVal(v)}`)
    .join("\n");

  const drafts = draftsFor(s);

  return `---
kind: ${s.kind}
key: ${s.key}
occurred_at: ${new Date(s.occurredAt * 1000).toISOString()}
detected_at: ${new Date().toISOString()}
importance: ${s.importance}
source: antseed-explorer signal detector
permission_required: false
${s.link ? `link: ${s.link}` : ""}
---

# ${s.headline}

Detected on ${day} from on-chain explorer data — public, no permission gate.

## Facts

${facts}

${s.context ? `## Context\n\n${s.context}\n` : ""}
## Drafts (Colony Scout voice)

### Standard post

${drafts.standard}

### Short reply variant (1–3 lines, ~140 chars)

${drafts.reply}

### Long-form thread (only if numbers warrant)

${drafts.thread}

## Suggested asset

${drafts.asset}

## Notes for the writer

- Verify the number against ${s.link ?? "antfeed.org"} before posting — indexer is near-real-time, not real-time.
- Voice = Colony Scout. Use the internal AntFeed Colony Scout voice rules. Do NOT use the operator first-person launch-thread mode for routine posts.
- If a stinger doesn't land naturally, drop it. Forcing "the colony does X" on a mundane day reads as parody.
- This card describes a daily delta. The story is the *movement*, not the static state.
- "ghost" / "ghosts" are banned vocabulary. If the data is about ChannelClosed-without-settlement, say "unsettled closures" or "closures with no settlement."
`;
}

interface Drafts {
  standard: string;
  reply: string;
  thread: string;
  asset: string;
}

function draftsFor(s: Signal): Drafts {
  switch (s.kind) {
    case "daily_snapshot": {
      const day = String(s.facts.day);
      const sessions = s.facts.sessions as number;
      const vol = s.facts.volume_usdc as number;
      const buyers = s.facts.active_buyers as number;
      const sellers = s.facts.active_sellers as number;
      return {
        standard: `${day} · colony snapshot.
${sessions} sessions. ${fmtUsd(vol)} settled.
${buyers} active buyers. ${sellers} active sellers.
the scout reads receipts.
→ ${s.link}`,
        reply: `${day}: ${sessions} sessions. ${fmtUsd(vol)} settled. ${buyers} buyers.
→ ${s.link}`,
        thread: `${day} · colony snapshot.

${sessions} sessions settled on-chain.
${fmtUsd(vol)} in USDC.
${buyers} distinct buyers active.
${sellers} sellers serving.

every line above is a SUM over public Base events. anyone can re-compute it.
→ ${s.link}`,
        asset: `antfeed.org hero metrics screenshot on ${day}, network revenue + daily activity visible.`,
      };
    }
    case "daily_new_sellers": {
      const day = String(s.facts.day);
      const count = s.facts.count as number;
      const featuredRaw = String(s.facts.featured);
      const featured = featuredRaw === "—" ? "" : featuredRaw;
      const remainderCount = s.facts.remainder_count as number;
      const sellerWord = count === 1 ? "seller" : "sellers";

      // Build the "includes …" line only when there's a display-named
      // entity to mention. Listing un-named hex addresses reads as spam.
      let includesLine = "";
      if (featured) {
        includesLine =
          remainderCount > 0
            ? `includes ${featured}, and ${remainderCount} more.`
            : `includes ${featured}.`;
      }

      const stdParts = [
        `${count} ${sellerWord} settled their first session on AntSeed (${day}).`,
        includesLine,
        `→ ${s.link}`,
      ].filter(Boolean);

      const replyParts = [
        `${count} ${sellerWord} settled their first session on AntSeed (${day}).`,
        // Reply variant is char-budget-sensitive; include featured only
        // when it's short (≤2 entities) so the post stays under 140 chars.
        featured && (s.facts.named_unique_count as number) <= 2
          ? featured + "."
          : "",
        `→ ${s.link}`,
      ].filter(Boolean);

      const threadParts = [
        `${count} ${sellerWord} settled their first session on AntSeed (${day}).`,
        "",
        includesLine || null,
        includesLine ? "" : null,
        `new supply means more competition. more competition means lower floors.`,
        `→ ${s.link}`,
      ].filter((p): p is string => p !== null);

      return {
        standard: stdParts.join("\n"),
        reply: replyParts.join("\n"),
        thread: threadParts.join("\n"),
        asset: `screenshot of antfeed.org/providers, or the named provider's profile page if there is one.`,
      };
    }
    case "daily_new_buyers": {
      const day = String(s.facts.day);
      const count = s.facts.count as number;
      return {
        standard: `${count} new buyers emerged on ${day}.
no signups. no wallet-connects. on-chain settlement only.
→ ${s.link}`,
        reply: `${count} new buyers on AntSeed (${day}).
→ ${s.link}`,
        thread: `${count} new buyer addresses emerged on ${day}.

these are not signups or wallet connects. each one opened a real channel and settled real USDC on Base.

the only signup is paying.
→ ${s.link}`,
        asset: `antfeed.org/buyers leaderboard screenshot, filtered to recent first-seen.`,
      };
    }
    case "daily_new_service_offered": {
      const day = String(s.facts.day);
      const services = String(s.facts.services);
      const count = s.facts.count as number;
      const counts = String(s.facts.provider_counts);
      const single = count === 1;
      return {
        standard: single
          ? `${services} newly available on AntSeed (${day}).
${counts}.
new supply landed.
→ ${s.link}`
          : `${count} new services available on AntSeed (${day}).
${services}.
${counts}.
new supply landed.
→ ${s.link}`,
        reply: single
          ? `${services} now on AntSeed (${day}).
→ ${s.link}`
          : `${count} new services on AntSeed (${day}): ${services}.
→ ${s.link}`,
        thread: `${single ? services + " is" : count + " new services are"} now available on AntSeed (${day}).

${counts}.

a service appearing means at least one provider posted pricing + capability for it. real on-chain offer, not a roadmap claim.
→ ${s.link}`,
        asset: `screenshot of antfeed.org/services or the service detail page.`,
      };
    }
    case "daily_service_supply_delta": {
      const day = String(s.facts.day);
      const movers = String(s.facts.movers);
      return {
        standard: `service supply moved on ${day}.
${movers}.
the offer side never sits still.
→ ${s.link}`,
        reply: `supply delta ${day}: ${movers}.
→ ${s.link}`,
        thread: `service supply moved on ${day}.

${movers}.

provider count per service = competition density. more providers offering the same model = lower floors and faster failover.
→ ${s.link}`,
        asset: `antfeed.org/services screenshot sorted by provider count.`,
      };
    }
    case "daily_volume_delta": {
      const day = String(s.facts.day);
      const yVol = s.facts.yesterday_volume_usdc as number;
      const avg = s.facts.trailing_7d_avg_usdc as number;
      const pct = s.facts.pct_change as number;
      const dir = String(s.facts.direction);
      const pctLabel = `${pct >= 0 ? "+" : ""}${pct}%`;
      return {
        standard: `${day} settled ${fmtUsd(yVol)}.
${pctLabel} vs trailing 7d avg (${fmtUsd(avg)}/day).
${dir === "above" ? "the colony ran hot." : "the colony breathed out."}
→ ${s.link}`,
        reply: `${day}: ${fmtUsd(yVol)} settled. ${pctLabel} vs 7d avg.
→ ${s.link}`,
        thread: `${day} settled volume: ${fmtUsd(yVol)}.

trailing 7-day average: ${fmtUsd(avg)}/day.
delta: ${pctLabel}.

no token incentive, no marketing push — just settled USDC. the slope tells the story.
→ ${s.link}`,
        asset: `antfeed.org daily volume chart with ${day} highlighted against the 7d trend.`,
      };
    }
  }
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function fmtUsd(n: number): string {
  if (n >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function isoDay(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

function slug(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function formatVal(v: string | number | boolean | null): string {
  if (v === null) return "_null_";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4);
  return String(v);
}
