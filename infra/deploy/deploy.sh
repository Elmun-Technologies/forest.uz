#!/usr/bin/env bash
# Production deploy / rollback on the UZ VPS (CLAUDE.md §6 "Production deploy";
# docs/runbooks/deploy-and-rollback.md).
#
#   infra/deploy/deploy.sh                deploy the checked-out commit (build images on this host)
#   infra/deploy/deploy.sh --pull         pull ${FOREST_REGISTRY}/forest-*:<tag> instead of building
#   infra/deploy/deploy.sh --tag <tag>    deploy an image tag that already exists locally/in the registry
#   infra/deploy/deploy.sh rollback       redeploy the previous tag (images are kept, schema is not
#                                         rolled back — migrations are expand/contract)
#   infra/deploy/deploy.sh status         current/previous tag and container health
#   infra/deploy/deploy.sh preflight      only check .env against the production rules
#
# Options: --no-backup (skip the pre-migration pg_dump), --allow-fake (staging/demo with fake
# providers: skips the PROVIDERS_MODE / ALLOW_FAKE_PROVIDERS / DEV_ENDPOINTS checks).
# Env: FOREST_ROOT (repo checkout, default this repo), HEALTH_TIMEOUT (s, default 240),
#      SMOKE_HOST / SMOKE_PORT (where Caddy listens for the smoke requests, 127.0.0.1:443).
. "$(dirname "$0")/../backup/lib.sh"
trap_alert deploy
cd "$FOREST_ROOT"

CMD=deploy PULL=false TAG="" BACKUP=true ALLOW_FAKE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    deploy | rollback | status | preflight) CMD="$1"; shift ;;
    --pull) PULL=true; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    --no-backup) BACKUP=false; shift ;;
    --allow-fake) ALLOW_FAKE=true; shift ;;
    *) die "unknown argument $1" ;;
  esac
done

STATE=.deploy
mkdir -p "$STATE"
compose() { "$FOREST_ROOT/infra/deploy/compose.sh" "$@"; }
ev() { app_env "$1"; }

preflight() {
  local errors=() v
  [[ -f .env ]] || die ".env missing in $FOREST_ROOT (start from .env.example; docs/launch-checklist.md)"
  grep -qE '^NODE_ENV=' .env && errors+=("NODE_ENV must not be set in .env (CLAUDE.md §17)")
  v="$(ev APP_ENCRYPTION_KEY)"
  [[ "$(printf '%s' "$v" | base64 -d 2>/dev/null | wc -c)" -eq 32 ]] ||
    errors+=("APP_ENCRYPTION_KEY must be 32 random bytes, base64")
  v="$(ev SESSION_SECRET)"
  [[ ${#v} -ge 32 && "$v" != generate* ]] || errors+=("SESSION_SECRET must be ≥ 32 random chars")
  v="$(ev WEB_REVALIDATE_SECRET)"
  [[ ${#v} -ge 32 && "$v" != generate* ]] ||
    errors+=("WEB_REVALIDATE_SECRET must be ≥ 32 random chars (api ↔ web signed calls fail closed without it)")
  [[ -n "$(ev POSTGRES_PASSWORD)" && "$(ev POSTGRES_PASSWORD)" != forest ]] ||
    errors+=("POSTGRES_PASSWORD must be set (not the dev default)")
  [[ -n "$(ev FOREST_APP_DB_PASSWORD)" ]] || errors+=("FOREST_APP_DB_PASSWORD must be set (API database role)")
  [[ "$(ev OWNER_INITIAL_PASSWORD)" != change-me* ]] || errors+=("OWNER_INITIAL_PASSWORD is the example value")
  [[ "$(ev S3_SECRET_KEY)" != forest-dev-secret ]] || errors+=("S3_SECRET_KEY is the dev value")
  for k in APP_URL ADMIN_URL API_URL; do
    [[ "$(ev "$k")" == https://* ]] || errors+=("$k must be https:// in production")
  done
  for k in SITE_DOMAIN ADMIN_DOMAIN API_DOMAIN S3_PUBLIC_URL; do
    [[ -n "$(ev "$k")" ]] || errors+=("$k must be set")
  done
  if [[ "$ALLOW_FAKE" == false ]]; then
    [[ "$(ev PROVIDERS_MODE)" =~ ^(sandbox|live)$ ]] || errors+=("PROVIDERS_MODE must be sandbox or live")
    [[ "$(ev DEV_ENDPOINTS)" != true ]] || errors+=("DEV_ENDPOINTS must be false (exposes OTP codes)")
    [[ "$(ev ALLOW_FAKE_PROVIDERS)" != true ]] || errors+=("ALLOW_FAKE_PROVIDERS must be false")
  fi
  # TRUST_PROXY_HOPS must match the proxy chain (docs/runbooks/deploy-network.md).
  local hops proxies
  hops="$(ev TRUST_PROXY_HOPS)" proxies="$(ev TRUSTED_PROXIES)"
  if [[ "${hops:-1}" == 2 && "${proxies:-private_ranges}" == private_ranges ]]; then
    errors+=("TRUST_PROXY_HOPS=2 (Cloudflare) needs TRUSTED_PROXIES = Cloudflare ranges (infra/deploy/cloudflare-ips.sh)")
  fi
  if [[ "${hops:-1}" == 1 && "${proxies:-private_ranges}" != private_ranges ]]; then
    errors+=("TRUSTED_PROXIES is set (Cloudflare?) but TRUST_PROXY_HOPS=1 — every visitor would share Cloudflare's IPs")
  fi
  [[ -f .env.ops ]] || log "WARN: .env.ops missing — backups and ops alerts are not configured"
  if ((${#errors[@]})); then
    printf '  ✖ %s\n' "${errors[@]}" >&2
    die "preflight failed (${#errors[@]} problems)"
  fi
  log "preflight ok"
}

# SeaweedFS (self-hosted S3) credentials file, generated from the app's S3 keys in .env.
seaweed_config() {
  local dir="infra/deploy/.secrets" f
  f="$dir/seaweedfs-s3.json"
  mkdir -p "$dir" && chmod 700 "$dir"
  local ak sk bucket
  ak="$(ev S3_ACCESS_KEY)" sk="$(ev S3_SECRET_KEY)" bucket="$(ev S3_BUCKET_PUBLIC)"
  [[ -n "$ak" && -n "$sk" ]] || die "S3_ACCESS_KEY / S3_SECRET_KEY must be set in .env"
  umask 077
  printf '{"identities":[{"name":"forest","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","List","Tagging","Write"]},{"name":"anonymous","actions":["Read:%s"]}]}\n' \
    "$ak" "$sk" "${bucket:-forest-public}" >"$f.new"
  mv "$f.new" "$f"
  # The container runs as root and only reads it.
  chmod 644 "$f"
}

wait_healthy() {
  local deadline=$(($(date +%s) + ${HEALTH_TIMEOUT:-240})) s svc ok
  while (($(date +%s) < deadline)); do
    ok=true
    for svc in api web admin; do
      s="$(docker inspect -f '{{.State.Health.Status}}' "$(service_container "$svc" 2>/dev/null)" 2>/dev/null || echo missing)"
      [[ "$s" == healthy ]] || ok=false
    done
    if [[ "$ok" == true ]]; then
      # Caddy waits for healthy apps (depends_on); if `up` gave up on a slow start, start it now.
      [[ "$(docker inspect -f '{{.State.Running}}' "$(service_container caddy 2>/dev/null)" 2>/dev/null)" == true ]] ||
        compose up -d --no-build caddy >/dev/null 2>&1 || true
      smoke && return 0
    fi
    sleep 5
  done
  return 1
}

# Through Caddy (TLS, routing, headers) — the path real customers and webhooks take.
smoke() {
  local host="${SMOKE_HOST:-127.0.0.1}" port="${SMOKE_PORT:-443}" site admin api
  site="$(ev SITE_DOMAIN)" admin="$(ev ADMIN_DOMAIN)" api="$(ev API_DOMAIN)"
  # SMOKE_INSECURE=1 only for a local test stack with Caddy's internal CA.
  local -a c=(curl -fsS -o /dev/null --max-time 10 ${SMOKE_INSECURE:+-k})
  "${c[@]}" --resolve "${site}:${port}:${host}" "https://${site}:${port}/uz" &&
    "${c[@]}" --resolve "${api}:${port}:${host}" "https://${api}:${port}/ready" &&
    "${c[@]}" --resolve "${admin}:${port}:${host}" "https://${admin}:${port}/login"
}

up_tag() {
  export FOREST_TAG="$1"
  # A container that fails its healthcheck makes `up` exit non-zero; wait_healthy decides.
  compose up -d --no-build --remove-orphans api web admin caddy || log "compose up reported a failure"
}

deploy() {
  preflight
  local prev tag
  prev="$(cat "$STATE/current" 2>/dev/null || true)"
  if [[ -n "$TAG" ]]; then
    tag="$TAG"
  else
    [[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
      die "working tree has local changes — deploy a clean commit"
    tag="$(git rev-parse --short=12 HEAD)"
  fi
  export FOREST_TAG="$tag"
  log "deploying ${tag} (previous: ${prev:-none})"
  seaweed_config

  if [[ "$PULL" == true ]]; then
    [[ -n "${FOREST_REGISTRY:-}" ]] || die "--pull needs FOREST_REGISTRY (e.g. ghcr.io/<owner>)"
    export FOREST_IMAGE_PREFIX="${FOREST_REGISTRY}/forest"
    compose pull migrate api web admin
  elif [[ -z "$TAG" ]]; then
    compose build postgres migrate api web admin
  fi

  compose up -d --wait --no-build postgres redis storage

  if [[ "$BACKUP" == true && -n "$prev" ]]; then
    log "pre-migration dump"
    BACKUP_DIR="$BACKUP_DIR" "$FOREST_ROOT/infra/backup/pg-dump.sh" --local-only
  fi

  log "migrations"
  compose run --rm --no-deps migrate
  log "database roles"
  docker exec -i "$(service_container postgres)" psql -X -q -U "$PG_USER" -d "$PG_DB" \
    -v ON_ERROR_STOP=1 -v app_password="$(ev FOREST_APP_DB_PASSWORD)" \
    -v ro_password="$(ev FOREST_RO_DB_PASSWORD)" -f - <infra/deploy/db-roles.sql

  up_tag "$tag"
  if wait_healthy; then
    [[ -n "$prev" && "$prev" != "$tag" ]] && printf '%s\n' "$prev" >"$STATE/previous"
    printf '%s\n' "$tag" >"$STATE/current"
    printf '%s %s\n' "$(date -u +%FT%TZ)" "$tag" >>"$STATE/history"
    prune_images
    log "deployed ${tag}"
    alert "deployed ${tag}"
    return 0
  fi

  compose ps >&2 || true
  compose logs --tail 80 api web admin >&2 || true
  if [[ -n "$prev" && "$prev" != "$tag" ]]; then
    alert "deploy ${tag} unhealthy — rolling back to ${prev}"
    up_tag "$prev"
    wait_healthy || die "rollback to ${prev} is unhealthy too — manual action needed"
    printf '%s %s (rollback after %s)\n' "$(date -u +%FT%TZ)" "$prev" "$tag" >>"$STATE/history"
    die "deploy ${tag} failed; rolled back to ${prev}"
  fi
  die "deploy ${tag} failed (no previous release to roll back to)"
}

rollback() {
  local prev cur
  prev="$(cat "$STATE/previous" 2>/dev/null || true)" cur="$(cat "$STATE/current" 2>/dev/null || true)"
  [[ -n "$prev" ]] || die "no previous release recorded in $STATE/previous"
  log "rolling back ${cur} → ${prev}"
  up_tag "$prev"
  wait_healthy || die "previous release ${prev} is unhealthy"
  printf '%s\n' "$cur" >"$STATE/previous"
  printf '%s\n' "$prev" >"$STATE/current"
  printf '%s %s (rollback)\n' "$(date -u +%FT%TZ)" "$prev" >>"$STATE/history"
  alert "rolled back to ${prev}"
}

# Keep the images of the last 3 releases (rollback targets), drop older forest-* tags.
prune_images() {
  local keep repo
  keep="$(tail -n 3 "$STATE/history" | awk '{print $2}' | sort -u)"
  for repo in api web admin migrate; do
    docker image ls --format '{{.Repository}}:{{.Tag}}' "${FOREST_IMAGE_PREFIX:-forest}-${repo}" |
      while read -r ref; do
        grep -qxF "${ref##*:}" <<<"$keep" || docker image rm "$ref" >/dev/null 2>&1 || true
      done
  done
}

exec 9>"$STATE/lock"
flock -n 9 || die "another deploy is running"
case "$CMD" in
  deploy) deploy ;;
  rollback) rollback ;;
  preflight) preflight ;;
  status)
    echo "current:  $(cat "$STATE/current" 2>/dev/null || echo -)"
    echo "previous: $(cat "$STATE/previous" 2>/dev/null || echo -)"
    compose ps
    ;;
esac
