#!/usr/bin/env bash
# Forest DEMO — one-time (idempotent) provisioning of the Fly.io side: API app, PostgreSQL 16,
# Redis 7 and two Tigris buckets, plus every Fly secret the API needs. Safe to re-run: existing
# apps, volumes, buckets and secrets are kept (generated secrets are never regenerated).
#
# Demo only (PROVIDERS_MODE=fake, synthetic data). Production stays on the UZ-hosted VPS
# (infra/compose.yml) — CLAUDE.md §6 / §15, docs/runbooks/deploy-demo.md.
#
# Needs: flyctl (logged in: `fly auth login`), jq, openssl. Optional: gh (logged in) + GH_REPO to
# store the shared APP_ENCRYPTION_KEY straight into the repository's Actions secrets.
#
# Usage (from the repo root):
#   DEMO_WEB_URL=https://forest-demo-web.vercel.app \
#   DEMO_ADMIN_URL=https://forest-demo-admin.vercel.app \
#   OWNER_EMAIL=owner@example.com \
#   [FLY_ORG=personal] [FLY_REGION=fra] [DEMO_PREFIX=forest-demo] [GH_REPO=owner/repo] \
#   infra/fly/provision.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

FLY_ORG="${FLY_ORG:-personal}"
FLY_REGION="${FLY_REGION:-fra}"
DEMO_PREFIX="${DEMO_PREFIX:-forest-demo}"
API_APP="${FLY_API_APP:-$DEMO_PREFIX-api}"
DB_APP="${FLY_DB_APP:-$DEMO_PREFIX-db}"
REDIS_APP="${FLY_REDIS_APP:-$DEMO_PREFIX-redis}"
# Tigris bucket names are global: change DEMO_PREFIX (or these) if a name is taken. No dots.
BUCKET_PUBLIC="${S3_BUCKET_PUBLIC:-$DEMO_PREFIX-public}"
BUCKET_PRIVATE="${S3_BUCKET_PRIVATE:-$DEMO_PREFIX-private}"
# New Tigris accounts serve public objects from <bucket>.t3.tigrisfiles.io (virtual-hosted).
S3_PUBLIC_URL="${S3_PUBLIC_URL:-https://$BUCKET_PUBLIC.t3.tigrisfiles.io}"
DB_VOLUME_GB="${DB_VOLUME_GB:-1}"
REDIS_VOLUME_GB="${REDIS_VOLUME_GB:-1}"

: "${DEMO_WEB_URL:?set DEMO_WEB_URL to the storefront Vercel production URL (https://<project>.vercel.app)}"
: "${DEMO_ADMIN_URL:?set DEMO_ADMIN_URL to the admin Vercel production URL (https://<project>.vercel.app)}"
: "${OWNER_EMAIL:?set OWNER_EMAIL (demo owner login; not a customer address)}"
DEMO_WEB_URL="${DEMO_WEB_URL%/}"
DEMO_ADMIN_URL="${DEMO_ADMIN_URL%/}"
API_URL="https://$API_APP.fly.dev"

for bin in flyctl jq openssl; do
  command -v "$bin" >/dev/null || { echo "✖ $bin is required" >&2; exit 1; }
done
flyctl auth whoami >/dev/null || { echo "✖ run 'fly auth login' first" >&2; exit 1; }

say() { printf '\n• %s\n' "$*"; }
rand_hex() { openssl rand -hex "$1"; }

app_exists() {
  flyctl apps list --json | jq -e --arg a "$1" 'any(.[]; (.Name // .name // .ID // .id) == $a)' >/dev/null
}
ensure_app() {
  if app_exists "$1"; then echo "  app $1 exists"; else flyctl apps create "$1" --org "$FLY_ORG"; fi
}
has_secret() {
  flyctl secrets list -a "$1" --json | jq -e --arg n "$2" 'any(.[]; (.Name // .name) == $n)' >/dev/null
}
ensure_volume() { # app name size
  if flyctl volumes list -a "$1" --json | jq -e --arg n "$2" 'any(.[]; (.name // .Name) == $n)' >/dev/null; then
    echo "  volume $2 on $1 exists"
  else
    flyctl volumes create "$2" -a "$1" --region "$FLY_REGION" --size "$3" --yes
  fi
}
machine_count() { flyctl machines list -a "$1" --json | jq 'length'; }
# Secrets are staged (no restart) and only reported by name; values never echo here.
SET_NAMES=()
stage_secrets() { # app KEY=VALUE...
  local app="$1"
  shift
  [ "$#" -gt 0 ] || return 0
  flyctl secrets set -a "$app" --stage "$@" >/dev/null
  for kv in "$@"; do SET_NAMES+=("$app:${kv%%=*}"); done
}

say "Apps ($FLY_ORG, region $FLY_REGION)"
ensure_app "$API_APP"
ensure_app "$DB_APP"
ensure_app "$REDIS_APP"

say "PostgreSQL 16 ($DB_APP)"
ensure_volume "$DB_APP" pgdata "$DB_VOLUME_GB"
db_has_pw=false api_has_db=false
has_secret "$DB_APP" POSTGRES_PASSWORD && db_has_pw=true
has_secret "$API_APP" DATABASE_URL && api_has_db=true
if ! $db_has_pw && ! $api_has_db; then
  PG_PASSWORD="$(rand_hex 24)"
  stage_secrets "$DB_APP" "POSTGRES_PASSWORD=$PG_PASSWORD"
  stage_secrets "$API_APP" \
    "DATABASE_URL=postgresql://forest:$PG_PASSWORD@$DB_APP.internal:5432/forest?connection_limit=10"
  unset PG_PASSWORD
elif [ "$db_has_pw" != "$api_has_db" ]; then
  echo "✖ only one of $DB_APP:POSTGRES_PASSWORD / $API_APP:DATABASE_URL exists; secrets can't be" >&2
  echo "  read back. Unset both (and destroy the pgdata volume if the DB was initialised), re-run." >&2
  exit 1
fi
if [ "$(machine_count "$DB_APP")" -eq 0 ]; then
  flyctl deploy --config infra/fly/postgres.fly.toml --app "$DB_APP" --ha=false --yes
else
  echo "  $DB_APP already running (redeploy by hand: fly deploy -c infra/fly/postgres.fly.toml -a $DB_APP)"
fi

say "Redis 7 ($REDIS_APP)"
ensure_volume "$REDIS_APP" redisdata "$REDIS_VOLUME_GB"
redis_has_pw=false api_has_redis=false
has_secret "$REDIS_APP" REDIS_PASSWORD && redis_has_pw=true
has_secret "$API_APP" REDIS_URL && api_has_redis=true
if ! $redis_has_pw || ! $api_has_redis; then
  # Redis reads the password on every start, so both sides can simply be (re)set together.
  REDIS_PW="$(rand_hex 24)"
  stage_secrets "$REDIS_APP" "REDIS_PASSWORD=$REDIS_PW"
  # .internal resolves to IPv6 only; ioredis defaults to IPv4 unless family=6.
  stage_secrets "$API_APP" "REDIS_URL=redis://:$REDIS_PW@$REDIS_APP.internal:6379?family=6"
  unset REDIS_PW
  redis_restart=true
else
  redis_restart=false
fi
if [ "$(machine_count "$REDIS_APP")" -eq 0 ] || $redis_restart; then
  flyctl deploy --config infra/fly/redis.fly.toml --app "$REDIS_APP" --ha=false --yes
else
  echo "  $REDIS_APP already running"
fi

say "Tigris buckets (public: $BUCKET_PUBLIC, private: $BUCKET_PRIVATE)"
bucket_exists() { flyctl storage list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$1"; }
# `fly storage create` prints the new bucket's access key once; capture it into Fly secrets.
create_bucket() { # name [--public]
  local out
  out="$(flyctl storage create --name "$1" --org "$FLY_ORG" --yes "${@:2}" 2>&1)" || {
    echo "$out" | grep -v -E 'SECRET|KEY' >&2
    return 1
  }
  printf '%s\n' "$out"
}
field() { printf '%s\n' "$1" | sed -n -E "s/^[[:space:]]*$2[[:space:]]*[:=][[:space:]]*\"?([^\" ]+)\"?.*$/\1/p" | head -1; }
if ! has_secret "$API_APP" S3_ACCESS_KEY; then
  if bucket_exists "$BUCKET_PUBLIC"; then
    echo "✖ bucket $BUCKET_PUBLIC exists but $API_APP has no S3_ACCESS_KEY (the key is shown only" >&2
    echo "  at creation). Create a key in the Tigris console (fly storage dashboard $BUCKET_PUBLIC) with" >&2
    echo "  Editor on both buckets and set S3_ACCESS_KEY/S3_SECRET_KEY/S3_ENDPOINT by hand." >&2
    exit 1
  fi
  OUT="$(create_bucket "$BUCKET_PUBLIC" --public)"
  KEY_ID="$(field "$OUT" AWS_ACCESS_KEY_ID)"
  KEY_SECRET="$(field "$OUT" AWS_SECRET_ACCESS_KEY)"
  ENDPOINT="$(field "$OUT" AWS_ENDPOINT_URL_S3)"
  unset OUT
  if [ -z "$KEY_ID" ] || [ -z "$KEY_SECRET" ]; then
    echo "✖ could not read the access key from 'fly storage create' output; set S3_ACCESS_KEY," >&2
    echo "  S3_SECRET_KEY on $API_APP by hand (fly storage dashboard $BUCKET_PUBLIC)." >&2
    exit 1
  fi
  stage_secrets "$API_APP" "S3_ACCESS_KEY=$KEY_ID" "S3_SECRET_KEY=$KEY_SECRET" \
    "S3_ENDPOINT=${ENDPOINT:-https://t3.storage.dev}"
  unset KEY_SECRET
  echo "  public bucket created; app key id: $KEY_ID"
else
  echo "  $API_APP already has S3 credentials"
fi
if bucket_exists "$BUCKET_PRIVATE"; then
  echo "  bucket $BUCKET_PRIVATE exists"
else
  # Its own key is discarded: the API uses one key for both buckets (see the step printed below).
  create_bucket "$BUCKET_PRIVATE" >/dev/null
  echo "  private bucket created"
fi
stage_secrets "$API_APP" "S3_BUCKET_PUBLIC=$BUCKET_PUBLIC" "S3_BUCKET_PRIVATE=$BUCKET_PRIVATE" \
  "S3_PUBLIC_URL=$S3_PUBLIC_URL"

say "API secrets ($API_APP)"
GENERATED_KEY=""
if ! has_secret "$API_APP" APP_ENCRYPTION_KEY; then
  GENERATED_KEY="$(openssl rand -base64 32)"
  stage_secrets "$API_APP" "APP_ENCRYPTION_KEY=$GENERATED_KEY"
fi
has_secret "$API_APP" SESSION_SECRET || stage_secrets "$API_APP" "SESSION_SECRET=$(rand_hex 32)"
has_secret "$API_APP" TELEGRAM_WEBHOOK_SECRET ||
  stage_secrets "$API_APP" "TELEGRAM_WEBHOOK_SECRET=$(rand_hex 16)"
GENERATED_OWNER_PW=""
if ! has_secret "$API_APP" OWNER_INITIAL_PASSWORD; then
  # ≥ 12 chars, not a common password (passwordProblems in contracts).
  GENERATED_OWNER_PW="Demo-$(rand_hex 10)"
  stage_secrets "$API_APP" "OWNER_INITIAL_PASSWORD=$GENERATED_OWNER_PW"
fi
# Non-secret but environment-specific: always (re)set so a changed Vercel URL takes effect.
stage_secrets "$API_APP" "OWNER_EMAIL=$OWNER_EMAIL" "APP_URL=$DEMO_WEB_URL" \
  "ADMIN_URL=$DEMO_ADMIN_URL" "API_URL=$API_URL" "WEB_INTERNAL_URL=$DEMO_WEB_URL"

if [ -n "$GENERATED_KEY" ] && [ -n "${GH_REPO:-}" ] && command -v gh >/dev/null; then
  printf '%s' "$GENERATED_KEY" | gh secret set DEMO_APP_ENCRYPTION_KEY -R "$GH_REPO"
  echo "  stored DEMO_APP_ENCRYPTION_KEY in $GH_REPO Actions secrets"
  GENERATED_KEY_STORED=true
else
  GENERATED_KEY_STORED=false
fi

say "Secrets staged (names only; applied on the next API deploy)"
printf '  %s\n' "${SET_NAMES[@]}"

cat <<EOF

────────────────────────────────────────────────────────────────────────────
Done. Next steps (docs/runbooks/deploy-demo.md):

1. Tigris key scope — the app uses ONE key (id printed above) for both buckets. Keys made by
   'fly storage create' may be limited to their own bucket: open 'fly storage dashboard
   $BUCKET_PUBLIC' → Access keys → that key → add Editor on '$BUCKET_PRIVATE'.
2. GitHub → Settings → Secrets and variables → Actions:
     variables: FLY_API_APP=$API_APP  DEMO_WEB_URL=$DEMO_WEB_URL
                DEMO_ADMIN_URL=$DEMO_ADMIN_URL  DEMO_S3_PUBLIC_URL=$S3_PUBLIC_URL
     secrets:   FLY_API_TOKEN, VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID_WEB,
                VERCEL_PROJECT_ID_ADMIN, DEMO_APP_ENCRYPTION_KEY
3. Run the "Deploy demo" workflow with seed = true (first time).
EOF
if [ -n "$GENERATED_KEY" ] && ! $GENERATED_KEY_STORED; then
  cat <<EOF

DEMO_APP_ENCRYPTION_KEY (shown once — save it as that GitHub secret now; the storefront on
Vercel verifies the API's revalidation calls with it, and Fly can't show it again):
  $GENERATED_KEY
EOF
fi
if [ -n "$GENERATED_OWNER_PW" ]; then
  cat <<EOF

Admin owner login (shown once; the seed creates the account; TOTP enrolment follows):
  $OWNER_EMAIL / $GENERATED_OWNER_PW
EOF
fi
