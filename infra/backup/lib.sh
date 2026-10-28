# shellcheck shell=bash
# Shared helpers for the backup / restore / deploy scripts (sourced, not executed).
#
# Server layout (docs/runbooks/deploy-and-rollback.md):
#   $FOREST_ROOT            repo checkout (default: two levels above this file), holds .env
#   $FOREST_ROOT/.env.ops   ops-only secrets: backup S3 keys, encryption passphrases, alert bot
#                           (git-ignored by `.env.*`; never inside an image — .dockerignore too)
#   $BACKUP_DIR             local backup area (default /var/backups/forest)

set -Eeuo pipefail

FOREST_ROOT="${FOREST_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
OPS_ENV_FILE="${OPS_ENV_FILE:-$FOREST_ROOT/.env.ops}"
if [[ -f "$OPS_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$OPS_ENV_FILE"
  set +a
fi
COMPOSE_PROJECT="${COMPOSE_PROJECT:-forest}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/forest}"
PG_USER="${PG_USER:-forest}"
PG_DB="${PG_DB:-forest}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() {
  log "ERROR: $*"
  exit 1
}

# Telegram ops alert (admin alerts group). Plain text, no PII: host, job, short reason.
# OPS_TELEGRAM_BOT_TOKEN / OPS_TELEGRAM_CHAT_ID come from .env.ops; silently skipped when unset.
alert() {
  local text="[forest $(hostname -s)] $*"
  log "ALERT: $*"
  [[ -n "${OPS_TELEGRAM_BOT_TOKEN:-}" && -n "${OPS_TELEGRAM_CHAT_ID:-}" ]] || return 0
  curl -fsS --max-time 15 -o /dev/null \
    --data-urlencode "chat_id=${OPS_TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${text}" \
    --data "disable_web_page_preview=true" \
    "https://api.telegram.org/bot${OPS_TELEGRAM_BOT_TOKEN}/sendMessage" ||
    log "alert delivery failed"
}

# `trap_alert <job>`: alert on a non-zero exit. Scripts add their own cleanup with `on_exit <cmd>`
# (one EXIT trap runs everything, so cleanup and alerting don't overwrite each other).
EXIT_HOOKS=()
on_exit() { EXIT_HOOKS+=("$*"); }
_run_exit_hooks() {
  local rc=$? hook
  for hook in "${EXIT_HOOKS[@]}"; do eval "$hook" || true; done
  if [[ $rc -ne 0 && -n "${ALERT_JOB:-}" ]]; then
    alert "${ALERT_JOB} FAILED (exit ${rc}); journalctl -u forest-${ALERT_JOB}"
  fi
  exit "$rc"
}
trap _run_exit_hooks EXIT
trap_alert() { ALERT_JOB="$1"; }

# Uptime Kuma push monitor (CLAUDE.md §6 "Uptime + ops alerts"): OPS_HEARTBEAT_URL_<JOB> in
# .env.ops, e.g. OPS_HEARTBEAT_URL_BACKUP_DB for job backup-db. A missed beat alerts in Kuma, so
# a timer that silently stops running is noticed too.
heartbeat() {
  local var="OPS_HEARTBEAT_URL_$(tr 'a-z-' 'A-Z_' <<<"$1")"
  [[ -n "${!var:-}" ]] || return 0
  curl -fsS --max-time 10 -o /dev/null "${!var}?status=up&msg=ok" || log "heartbeat $1 failed"
}

# Container id of a compose service of $COMPOSE_PROJECT (works for the dev and the prod project).
service_container() {
  local id
  id="$(docker ps -q \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
    --filter "label=com.docker.compose.service=$1" | head -n1)"
  [[ -n "$id" ]] || die "service '$1' of compose project '${COMPOSE_PROJECT}' is not running"
  printf '%s' "$id"
}

# rclone with remotes defined only by environment variables (no config file with secrets).
#   backup:   S3 bucket in Uzbekistan (BACKUP_S3_*), the raw remote
#   bcrypt:   encrypted view of backup:$BACKUP_S3_BUCKET (rclone crypt = NaCl secretbox, authenticated)
#   live:     the application's object storage (S3_* from .env), read-only use
# Runs the official rclone image so the host needs only docker.
RCLONE_IMAGE="${RCLONE_IMAGE:-rclone/rclone:1.71.2}"
rclone_run() {
  [[ -n "${BACKUP_S3_ENDPOINT:-}" && -n "${BACKUP_S3_BUCKET:-}" ]] ||
    die "BACKUP_S3_ENDPOINT / BACKUP_S3_BUCKET not set in $OPS_ENV_FILE"
  [[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]] || die "BACKUP_ENCRYPTION_PASSPHRASE not set"
  local obscured
  obscured="$(docker run --rm "$RCLONE_IMAGE" obscure "$BACKUP_ENCRYPTION_PASSPHRASE")"
  local -a env=(
    -e RCLONE_CONFIG_BACKUP_TYPE=s3
    -e RCLONE_CONFIG_BACKUP_PROVIDER=Other
    -e "RCLONE_CONFIG_BACKUP_ENDPOINT=${BACKUP_S3_ENDPOINT}"
    -e "RCLONE_CONFIG_BACKUP_REGION=${BACKUP_S3_REGION:-us-east-1}"
    -e "RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID=${BACKUP_S3_ACCESS_KEY:-}"
    -e "RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY=${BACKUP_S3_SECRET_KEY:-}"
    -e "RCLONE_CONFIG_BACKUP_FORCE_PATH_STYLE=${BACKUP_S3_FORCE_PATH_STYLE:-true}"
    -e RCLONE_CONFIG_BCRYPT_TYPE=crypt
    -e "RCLONE_CONFIG_BCRYPT_REMOTE=backup:${BACKUP_S3_BUCKET}"
    -e "RCLONE_CONFIG_BCRYPT_PASSWORD=${obscured}"
    -e RCLONE_CONFIG_BCRYPT_FILENAME_ENCRYPTION=off
  )
  if [[ -n "${S3_ENDPOINT_FOR_BACKUP:-}" ]]; then
    env+=(
      -e RCLONE_CONFIG_LIVE_TYPE=s3
      -e RCLONE_CONFIG_LIVE_PROVIDER=Other
      -e "RCLONE_CONFIG_LIVE_ENDPOINT=${S3_ENDPOINT_FOR_BACKUP}"
      -e "RCLONE_CONFIG_LIVE_REGION=${S3_REGION:-us-east-1}"
      -e "RCLONE_CONFIG_LIVE_ACCESS_KEY_ID=${S3_ACCESS_KEY:-}"
      -e "RCLONE_CONFIG_LIVE_SECRET_ACCESS_KEY=${S3_SECRET_KEY:-}"
      -e "RCLONE_CONFIG_LIVE_FORCE_PATH_STYLE=${S3_FORCE_PATH_STYLE:-true}"
    )
  fi
  docker run --rm ${RCLONE_NETWORK:+--network "$RCLONE_NETWORK"} \
    -v "$BACKUP_DIR:/backup" "${env[@]}" "$RCLONE_IMAGE" "$@"
}

# Reads KEY from the app .env without sourcing it (values may contain shell metacharacters).
app_env() {
  local v
  v="$(grep -E "^$1=" "$FOREST_ROOT/.env" 2>/dev/null | tail -n1 | cut -d= -f2-)"
  v="${v%%#*}"
  v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "$v"
}
