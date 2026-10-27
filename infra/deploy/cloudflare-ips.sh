#!/usr/bin/env bash
# Prints the TRUSTED_PROXIES value (space-separated CIDRs) for Caddy when Cloudflare is in front
# (docs/runbooks/deploy-network.md; pair with TRUST_PROXY_HOPS=2). Paste it into .env and redeploy;
# re-run when Cloudflare publishes changes (rare). Also usable for an origin firewall allowlist.
set -Eeuo pipefail
v4="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4)"
v6="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6)"
list="$(printf '%s\n%s\n' "$v4" "$v6" | grep -E '^[0-9a-fA-F:.]+/[0-9]+$' | tr '\n' ' ')"
[[ $(wc -w <<<"$list") -ge 10 ]] || { echo "unexpected answer from cloudflare.com/ips" >&2; exit 1; }
echo "TRUSTED_PROXIES=${list% }"
