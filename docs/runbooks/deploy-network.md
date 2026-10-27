# Runbook · client IP behind Cloudflare and Caddy

Rate limits (OTP sends, leads, checkout) key on the client IP the API derives from
`X-Forwarded-For` with Express `trust proxy = TRUST_PROXY_HOPS`. Express takes the entry that many
hops from the right, so the setting must match the real proxy chain or every visitor behind one
edge shares a limit (logins fail with 429) — or visitors can spoof their IP.

| Chain | Caddy `TRUSTED_PROXIES` | API `TRUST_PROXY_HOPS` | XFF the API sees |
|---|---|---|---|
| Browser → Caddy → web/api (no CDN) | `private_ranges` (default) | `1` | `client` (Caddy replaces untrusted XFF) |
| Browser → Cloudflare → Caddy → web/api | Cloudflare IPv4+IPv6 ranges | `2` | `…, client, cf-edge` |

- The storefront's `/api/*` rewrite (Next) forwards XFF unchanged and adds no hop, so browser
  calls through the web app and direct calls to `API_DOMAIN` (Payme/Click webhooks) resolve the
  same way.
- Never publish web :3000, admin :3001 or api :4000 beyond 127.0.0.1 (compose binds them
  locally): a direct request could set its own XFF.
- Cloudflare ranges change rarely; refresh `TRUSTED_PROXIES` from https://www.cloudflare.com/ips/
  when they do (space-separated CIDRs).
- Check after deploy: two requests from different networks to `POST /v1/auth/otp/send` must hit
  separate limits; one network must get 429 after 5 sends/hour.
- Demo on Vercel + Fly.io (no Caddy): `TRUST_PROXY_HOPS=2` plus `EDGE_PROXY_SECRET` (the web/admin
  middleware's `X-Forest-Edge` marker; requests without it keep only their real peer address) —
  chain and post-deploy check in `docs/runbooks/deploy-demo.md` ("Client IP").
