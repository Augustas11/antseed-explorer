#!/usr/bin/env bash
# Single-command Vercel deploy. Idempotent — safe to re-run.
#
# What it does:
#   1. Installs Vercel CLI if missing.
#   2. Logs you into Vercel (one-time browser flow).
#   3. Links this directory to a Vercel project (creates one if needed).
#   4. Generates a CRON_SECRET and stores it locally so subsequent runs reuse it.
#   5. Prompts you for your Neon DATABASE_URL (with a button to create one).
#   6. Pushes all env vars to Vercel (production environment).
#   7. Runs `vercel deploy --prod`.
#   8. (Optional) imports your local SQLite history into the new Neon DB.
#   9. Prints the final URL + cron-job.org wiring instructions.
#
# Usage:
#   ./scripts/deploy.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# ---------- terminal styling ----------
b="\033[1m"; dim="\033[2m"; cyan="\033[36m"; green="\033[32m"; red="\033[31m"; yel="\033[33m"; r="\033[0m"
say()  { printf "${cyan}▶${r} %s\n" "$*"; }
ok()   { printf "${green}✓${r} %s\n" "$*"; }
warn() { printf "${yel}!${r} %s\n" "$*" >&2; }
die()  { printf "${red}✗${r} %s\n" "$*" >&2; exit 1; }
ask()  { printf "${b}?${r} %s " "$*" >&2; }

# ---------- 1. Vercel CLI ----------
if ! command -v vercel >/dev/null 2>&1; then
  say "Installing Vercel CLI globally…"
  npm install -g vercel || die "npm install -g vercel failed (try with sudo, or install Node via fnm/nvm)"
fi
ok "Vercel CLI: $(vercel --version)"

# ---------- 2. Vercel login ----------
if ! vercel whoami >/dev/null 2>&1; then
  say "Opening browser for Vercel login…"
  vercel login || die "vercel login failed"
fi
ok "Logged in as $(vercel whoami)"

# ---------- 3. Link project ----------
if [ ! -d .vercel ]; then
  say "Linking this directory to a Vercel project (will create one if needed)…"
  vercel link --yes || die "vercel link failed"
fi
ok "Project linked: $(jq -r '.projectId' .vercel/project.json 2>/dev/null || echo unknown)"

# ---------- 4. CRON_SECRET ----------
SECRET_FILE=".vercel/.cron_secret"
if [ -f "$SECRET_FILE" ]; then
  CRON_SECRET=$(cat "$SECRET_FILE")
  ok "Reusing existing CRON_SECRET (stored in $SECRET_FILE)"
else
  CRON_SECRET=$(openssl rand -hex 32)
  echo "$CRON_SECRET" > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
  ok "Generated new CRON_SECRET → $SECRET_FILE"
fi

# ---------- 5. DATABASE_URL ----------
echo
echo "${b}Neon Postgres setup${r}"
echo "  If you don't already have a Neon DB connected to this project, do one of:"
echo "    a) Vercel dashboard → your project → ${cyan}Storage${r} → Create → Neon (one-click)"
echo "    b) Sign up free at ${cyan}https://neon.tech${r} and copy the connection string"
echo
ask "Paste your Neon DATABASE_URL (or press Enter if already set in Vercel):"
read -r DB_URL_INPUT
# Strip leading/trailing whitespace and surrounding quotes if the user pasted
# the URL inside ' or " — `read -r` keeps those as literal characters.
DB_URL_INPUT="${DB_URL_INPUT#"${DB_URL_INPUT%%[![:space:]]*}"}"
DB_URL_INPUT="${DB_URL_INPUT%"${DB_URL_INPUT##*[![:space:]]}"}"
[[ "$DB_URL_INPUT" =~ ^\".*\"$ || "$DB_URL_INPUT" =~ ^\'.*\'$ ]] \
  && DB_URL_INPUT="${DB_URL_INPUT:1:-1}"
echo

# ---------- 6. Push env vars ----------
push_env() {
  local name="$1"; local value="$2"
  # Remove existing value first (silent if not present), then add fresh.
  vercel env rm "$name" production --yes >/dev/null 2>&1 || true
  printf "%s" "$value" | vercel env add "$name" production >/dev/null 2>&1 \
    && ok "  $name (production)" \
    || warn "  failed to set $name"
}

say "Pushing env vars to Vercel (production)…"
push_env RPC_URL "https://base.drpc.org"
push_env CHAIN_ID "8453"
push_env LOG_BATCH_SIZE "2000"
push_env CRON_SECRET "$CRON_SECRET"
if [ -n "$DB_URL_INPUT" ]; then
  push_env DATABASE_URL "$DB_URL_INPUT"
fi

# ---------- 7. Deploy ----------
say "Deploying to production…"
DEPLOY_URL=$(vercel deploy --prod --yes 2>&1 | tee /tmp/vercel_deploy.log | tail -1 || true)
if ! echo "$DEPLOY_URL" | grep -qE "^https://"; then
  warn "Could not parse deploy URL. Last 30 lines of output:"
  tail -30 /tmp/vercel_deploy.log >&2
  die "Deploy failed"
fi
ok "Deployed: $DEPLOY_URL"

# ---------- 8. Import legacy data (optional) ----------
SQLITE="./data/explorer.db"
if [ -f "$SQLITE" ] && [ -n "$DB_URL_INPUT" ]; then
  echo
  ask "Import existing SQLite history (~$(du -h "$SQLITE" | awk '{print $1}')) into Neon? [Y/n]"
  read -r IMPORT_ANS
  if [[ ! "$IMPORT_ANS" =~ ^[nN] ]]; then
    say "Importing $SQLITE → Neon…"
    DATABASE_URL="$DB_URL_INPUT" npx tsx scripts/import-sqlite.ts || warn "Import failed; you can re-run later with 'npm run import:sqlite'"
  fi
fi

# ---------- 9. Smoke test + Vercel cron instructions ----------
echo
say "Smoke-testing /api/stats…"
sleep 2
STATS=$(curl -fsS "$DEPLOY_URL/api/stats" 2>/dev/null || echo "")
if [ -n "$STATS" ]; then
  echo "$STATS" | python3 -m json.tool 2>/dev/null | head -10 || echo "$STATS" | head -c 400
  ok "API responding"
else
  warn "API didn't respond yet (cold start?). Try again in 30s: curl $DEPLOY_URL/api/stats"
fi

cat <<EOF

${b}${green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${r}
${b}DONE.${r}

  App:      ${cyan}$DEPLOY_URL${r}
  Cron URL: ${cyan}$DEPLOY_URL/api/cron/sync${r} ${dim}(managed by vercel.json every 5 min)${r}
  Secret:   stored in $SECRET_FILE (mode 600)

${b}Post-deploy checks:${r}

  1. Confirm Vercel shows the /api/cron/sync schedule from vercel.json.
  2. Verify shared rate-limit storage before production traffic:
       DATABASE_URL=... npm run check:rate-limit-storage
  3. For an authenticated hero repair only, call:
       curl -H "Authorization: Bearer $CRON_SECRET" "$DEPLOY_URL/api/cron/hero?repair=1"

To re-deploy after code changes:
  git push      ${dim}# Vercel auto-deploys on push to main${r}
  - or -
  ./scripts/deploy.sh   ${dim}# manual prod deploy from local${r}

EOF
