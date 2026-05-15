#!/usr/bin/env bash
# Fetch SQL + latest cached results for all dashboard query IDs.
set -euo pipefail
KEY="${DUNE_API_KEY:?}"
OUT_SQL=".omc/research/dune-queries"
OUT_SNAP=".omc/research/dune-snapshots"
mkdir -p "$OUT_SQL" "$OUT_SNAP"

# query_id|widget_title|chart_desc
QUERIES=(
  "6973980|Total Tokens Consumed|counter"
  "6978394|Cumulative and daily volume USD|chart"
  "7442088|Daily total tokens consumed|chart"
  "6974179|Daily active users and new users|chart"
  "6978909|Cumulative and daily requests|chart"
  "7435653|Users|counter"
  "6974186|Monthly active users|chart"
  "7340721|ANTS released and claimed|chart"
  "7382462|Leaderboard|table"
  "7435819|Average LTV in USDC|counter"
  "7437503|Median LTV in USDC|counter"
)

TS="$(date -u +%Y%m%dT%H%M%SZ)"
echo "ts=$TS"

for entry in "${QUERIES[@]}"; do
  IFS='|' read -r qid title kind <<<"$entry"
  echo "==> $qid ($title, $kind)"
  # SQL metadata
  curl -s -H "X-Dune-API-Key: $KEY" "https://api.dune.com/api/v1/query/$qid" \
    > "$OUT_SQL/$qid.json"
  # Save just the SQL with a header
  jq -r --arg title "$title" --arg kind "$kind" --arg qid "$qid" '
    "-- Dune query " + $qid + " — widget: " + $title + " (" + $kind + ")\n" +
    "-- Dashboard: https://dune.com/antseed_com/antseed\n" +
    "-- Owner: " + .owner + "  version: " + (.version|tostring) + "\n" +
    "-- Description: " + (.description // "") + "\n\n" +
    .query_sql
  ' "$OUT_SQL/$qid.json" > "$OUT_SQL/$qid.sql"
  # Latest cached results (no execution credits used)
  curl -s -H "X-Dune-API-Key: $KEY" \
    "https://api.dune.com/api/v1/query/$qid/results?limit=1000" \
    > "$OUT_SNAP/$qid-$TS.json"
done

echo "done. ts=$TS"
