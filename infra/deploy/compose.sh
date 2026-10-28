#!/usr/bin/env bash
# `docker compose` with the production project, env files and override (CLAUDE.md §6 deploy).
# Examples:  infra/deploy/compose.sh ps
#            infra/deploy/compose.sh logs --tail 200 api
#            infra/deploy/compose.sh exec postgres psql -U forest forest
# FOREST_TAG defaults to the currently deployed tag (.deploy/current).
set -Eeuo pipefail
ROOT="${FOREST_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"
if [[ -z "${FOREST_TAG:-}" && -f .deploy/current ]]; then FOREST_TAG="$(cat .deploy/current)"; fi
export FOREST_TAG="${FOREST_TAG:-unset}"

# Storefront CSP image/media source derived from S3_PUBLIC_URL in .env (infra/Caddyfile).
origin() { sed -E 's#^(https?://[^/]+).*#\1#' <<<"$1"; }
env_value() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/^"(.*)"$/\1/'; }
export CSP_S3_ORIGIN="${CSP_S3_ORIGIN:-$(origin "$(env_value S3_PUBLIC_URL)")}"

args=(-p "${COMPOSE_PROJECT:-forest}" --env-file .env)
[[ -f .env.ops ]] && args+=(--env-file .env.ops)
args+=(-f infra/compose.yml -f infra/deploy/compose.prod.yml)
[[ -n "${COMPOSE_EXTRA_FILE:-}" ]] && args+=(-f "$COMPOSE_EXTRA_FILE")
exec docker compose "${args[@]}" --profile apps "$@"
