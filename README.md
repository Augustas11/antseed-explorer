# AntSeed Demand Explorer

> Live at **[antfeed.org](https://antfeed.org)**

An open-source, on-chain index of **buyer activity** on the [AntSeed](https://antseed.com) P2P AI services network. Provider/seller activity is already surfaced on `antseed.com/network`; this app fills the gap on the demand side: who is spending USDC on inference, with which providers, and how reliably.

Not affiliated with the AntSeed team.

---

## What it does

1. **Buyer profiles** — per-address volume, sessions, unique sellers, ghost-session count, and a derived **Buyer Trust Score** (0–100).
2. **Network leaderboard** — sortable, filterable buyer ranking.
3. **Network overview** — daily settlement volume, active buyers, last 30 days.
4. **Token-level session detail** — input/output tokens and request count per settled session, decoded from `ChannelSettled.metadata`.
5. **Public scoring API** — `GET /api/score/[address]` returns the trust score JSON for any address.

---

## Stack

- Next.js 14 (App Router) + TypeScript
- [viem](https://viem.sh) for Base reads (no wallet, read-only)
- Neon Postgres + Drizzle ORM (HTTP driver, serverless-friendly)
- Tailwind CSS, Recharts

---

## Getting started locally

```bash
cp .env.example .env       # fill DATABASE_URL with a Neon DB or a local Postgres
npm install
npm run db:push            # apply schema to your DB
npm run dev
```

| Script | What it does |
|---|---|
| `npm run dev` | Local Next.js dev server |
| `npm run build` | Production build |
| `npm run db:generate` | Diff schema and emit a new migration in `drizzle/` |
| `npm run db:push` | Apply schema directly (dev-only, no migration history) |
| `npm run db:migrate` | Apply pending migrations from `drizzle/` |
| `npm run db:studio` | Open Drizzle Studio for browsing the DB |
| `npm run sync` | Run a one-shot indexer pass against the configured DB |
| `npm run sync loop` | Loop until caught up to chain head |

---

## Environment variables

| var | default | meaning |
|---|---|---|
| `DATABASE_URL` | required | Postgres connection string. |
| `RPC_URL` | `https://base.drpc.org` | Base RPC. DRPC and Tenderly free tiers allow large `eth_getLogs` ranges. |
| `CHAIN_ID` | `8453` | `8453` Base mainnet, `84532` Base Sepolia. |
| `CRON_SECRET` | none | Required in production. Cron requests must send `Authorization: Bearer <CRON_SECRET>`. |
| `LOG_BATCH_SIZE` | `2000` | Max blocks per `getLogs`. Indexer auto-shrinks if RPC complains. |
| `CHANNELS_ADDRESS` | `0xBA66d3b4f...` | Override only if you've forked to a different contract. |
| `START_BLOCK` | deployment block | First block to index from. |

---

## Contract integration

Single contract: **`AntseedChannels`** on Base mainnet,
[`0xBA66d3b4fbCf472F6F11D6F9F96aaCE96516F09d`](https://basescan.org/address/0xBA66d3b4fbCf472F6F11D6F9F96aaCE96516F09d), deployed at block `45,667,842`.

| event | semantic |
|---|---|
| `Reserved` | session opened (buyer locks `maxAmount` for a seller). |
| `ChannelSettled` | seller called settle; `delta` USDC moved this batch. `metadata` = `[version, inputTokens, outputTokens, requestCount]`. |
| `ChannelClosed` | channel closed. `settledAmount=0` + no prior `ChannelSettled` → ghost. |
| `ChannelTopUp` | buyer added more deposit to an existing channel. |
| `ChannelWithdrawn` | buyer pulled refund. |
| `CloseRequested` | grace-period close started. |

Per-buyer aggregates are recomputed in SQL on every sync — no event replay needed for score recomputes. The indexer runs `reconcileDrift()` after each pass to catch rare partial-sync races.

---

## Buyer Trust Score

[`lib/score.ts`](lib/score.ts), 0–100, four sub-scores:

- **Volume (0–30)** — `log10(USDC + 1) / log10(100) × 30`. $100 settled = 30.
- **Consistency (0–25)** — `log10(sessions + 1) / log10(50) × 25`.
- **Diversity (0–25)** — `<3` unique sellers = 0; 3 = 10; 10+ = 25.
- **Reliability (0–20)** — `settled / (settled + ghost) × 20`.

A buyer with ≥3 distinct settled sellers earns the **Qualified Proven Sign** badge.

---

## Public APIs

```
GET  /api/stats                      Network aggregates + 30d daily series
GET  /api/buyers?limit=&offset=&qualified=&minScore=&sort=
GET  /api/buyers/{address}           Full profile + sessions + top sellers
GET  /api/score/{address}            Trust score JSON
POST /api/sync?force=1               Manual indexer pass
```

`/api/score/{address}` example:
```json
{
  "address": "0x…",
  "score": 73,
  "tier": "trusted",
  "qualified": true,
  "breakdown": {
    "total": 73,
    "volume": 24.1,
    "consistency": 18.0,
    "diversity": 18.6,
    "reliability": 12.0,
    "qualified": true
  },
  "stats": { "…": "raw indexed counters" }
}
```

---

## Project layout

```
antseed-explorer/
  app/
    layout.tsx                  # nav + Sync button
    page.tsx                    # / overview + top 10
    buyers/page.tsx             # /buyers leaderboard
    buyers/[address]/page.tsx   # buyer profile
    api/
      cron/sync/route.ts        # cron-driven indexer pass
      sync/route.ts             # manual sync (Sync now button)
      buyers/route.ts
      buyers/[address]/route.ts
      stats/route.ts
      score/[address]/route.ts
    components/                 # SyncButton, Charts, Badges, CopyButton
  lib/
    schema.ts                   # Drizzle Postgres schema
    db.ts                       # Neon HTTP client + state helpers
    queries.ts                  # all reads used by pages/APIs
    indexer.ts                  # getLogs loop, ghost detection, recompute, reconcile
    antseed.ts                  # contract addresses + ABI
    chain.ts                    # viem client
    score.ts                    # Buyer Trust Score
    format.ts
  scripts/
    sync-cli.ts                 # local CLI sync against DATABASE_URL
  drizzle/                      # generated migrations
  vercel.json                   # cron config + maxDuration
```

---

## Contributing

Issues and PRs are welcome. The most useful contributions right now:

- Improved scoring models or new score dimensions
- Additional on-chain event types or contract support
- UI improvements and new views (e.g. seller-side explorer)
- Better RPC resilience / retry logic in the indexer

Open an issue to discuss before submitting a large change.
