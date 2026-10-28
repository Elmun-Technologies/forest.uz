# Load tests (k6)

docs/12 Phase 6 targets: **catalog browse 200 rps**, **checkout 20 rps**. Decision and limits:
CLAUDE.md §6 "Load test". Scripts run with the official k6 image — nothing to install.

| File | What |
|---|---|
| `browse.js` | visitor journeys: home or category → product (+ reviews JSON) → second product or catalog → search or cart; settings JSON like the browser; think time 2–10 s; `RATE` = target page/API requests per second (≈ 4 requests per journey); asks for compression like browsers |
| `checkout.js` | buyers: add to cart → quote → cart → place order (50 % COD, 50 % Payme/Click) → fake payment → order page; think time 5–60 s; `RATE` = orders per second; unique phone and client IP per buyer |
| `lib.js` | config, think time, fake phone/IP/idempotency key |
| `staging-prepare.sql` | tops up stock of every active variant (staging only; refuses a DB with recent real orders) |

Thresholds (fail the run): browse — errors < 1 %, pages p95 < 800 ms / p99 < 2 s, API JSON p95
< 300 ms; checkout — errors < 1 %, place-order p95 < 1.5 s / p99 < 3 s, cart add / quote p95
< 500 ms, < 10 checkout errors.

## Running against staging

Staging = the production compose on a staging VPS with `PROVIDERS_MODE=fake`,
`ALLOW_FAKE_PROVIDERS=true` (`deploy.sh --allow-fake`), a database **restored from a production
backup for the run** (restore-db.md) and thrown away afterwards. Never against production: checkout
writes real orders, holds stock and (in fake mode only) marks them paid.

```bash
# 1. stock for the run (owner role)
docker exec -i forest-postgres-1 psql -U forest -d forest -v ON_ERROR_STOP=1 \
  -c "SET forest.allow_loadtest = on" -f - < loadtest/staging-prepare.sql

# 2. browse through the public URL (Cloudflare/Caddy/TLS included), from another machine
docker run --rm -v "$PWD/loadtest:/scripts:ro" grafana/k6:1.3.0 run \
  -e SITE=https://staging.forest.uz -e RATE=200 -e RAMP=2m -e DURATION=10m /scripts/browse.js

# 3. checkout ON the staging server, inside the compose network, straight to the API
docker run --rm --network forest_egress -v "$PWD/loadtest:/scripts:ro" grafana/k6:1.3.0 run \
  -e API=http://api:4000/v1 -e RATE=20 -e RAMP=1m -e DURATION=5m /scripts/checkout.js
```
Why checkout runs in-network: the API allows 10 checkouts/min per client IP. Behind Caddy every
k6 request has the k6 machine's IP (Caddy replaces untrusted `X-Forwarded-For`), so the test
would measure the rate limiter. Directly at `api:4000` with `TRUST_PROXY_HOPS=1`, Express takes
the per-buyer `X-Forwarded-For` (CGNAT range 100.64/10) as the client. The API sets its cookies
`Secure`; over in-network HTTP the script carries them by hand.

Useful variables: `THINK_SCALE` (0 = no think time, 1 = realistic), `VUS`/`MAX_VUS`, `INSECURE=1`
(self-signed TLS), `HOSTS="shop.example=10.0.0.5"` (resolve a name to an IP, keeps TLS SNI),
`DEV_TOKEN` (when the staging API sets `DEV_ENDPOINTS_TOKEN`; fake-pay itself needs no token),
`DEBUG=1` (prints the first failing checkout bodies).

While it runs: `docker stats`, `infra/deploy/compose.sh logs -f api | grep '"statusCode":5'`, and
afterwards `pg_stat_statements` (monitoring.md §4).

## Results — local smoke, 2026-10-27

Environment: the production compose (`compose.prod.yml`, project `forest-prodtest`) on the 4-vCPU
development machine next to the running dev stack, seed catalogue (8 products / 14 variants),
fake providers, k6 1.3.0 in the compose network; browse through Caddy (TLS, zstd/gzip), checkout
straight to `api:4000`. Short runs (20 s ramp + 60 s) at reduced rates — a smoke, not a capacity
certificate: the machine is ~4× smaller than a realistic production plan and shared.

| Run | Target | Achieved | Latency | Errors | Saturation |
|---|---|---|---|---|---|
| browse, 1 web replica, think ×0.3 | 10 rps | 15.3 req/s | pages p95 303 ms / p99 402 ms; API p95 42 ms | 0 % | web ≈ 1 core |
| browse, 1 web replica | 40 rps | 36.5 req/s (137 journeys dropped) | pages p95 **8.8 s**; API p95 574 ms | 0 % | web 100 % of its single core; api 9 %, postgres 7 % |
| browse, **3 web replicas** (Caddy `dynamic a`, least_conn) | 40 rps | 46.9 req/s | pages p95 680 ms / p99 1.03 s; API p95 141 ms | 0 % | web 3 × ~65–70 %; api 11 %; postgres 3 % |
| checkout, think ×0.05 | 20 orders/s | **15.3 orders/s** (1 549 orders, 60 dropped) | place order p95 **6.0 s**; cart add p95 1.95 s; quote p95 494 ms | 0 % (0 checkout errors) | api ≈ 108 % avg / 150 % peak (one Node process); postgres 38 % |
| (discarded) browse while other agents built images, load avg 18 | 20 rps | 13 req/s | p95 22 s | 0 % | host CPU |

## Bottlenecks and suggestions (for the app owners — no app code changed here)

1. **Storefront CPU per page.** Product and category pages answer
   `Cache-Control: private, no-cache, no-store` — rendered on every request (≈ 60–90 ms CPU), while
   home and cart are ISR (`s-maxage=30`). One Node process serves ~15–20 such pages/s. 200 rps of
   this mix needs ~10–12 storefront cores **or** making product/category pages cacheable (move the
   cookie/searchParams reads that force `dynamic` into client islands or route handlers so the HTML
   is ISR like the home page). That is the single most valuable performance change; it also lets
   Cloudflare/Caddy absorb spikes. Done on the ops side: `WEB_REPLICAS` (default 2) behind Caddy.
2. **HTML weight.** 240–360 KB per page uncompressed (40–70 KB compressed): inlined CSS is copied into
   the RSC payload too (CLAUDE.md §6 inline-CSS trade-off). Compression costs CPU at the edge on
   every dynamic page; ISR pages would be compressed once per revalidation by a cache in front.
3. **API = one process for REST + BullMQ + bot.** Checkout saturates it at ~15 orders/s on this
   machine. Options: run BullMQ workers in a second container of the same image (needs a small app
   switch such as `API_ROLE=web|worker` so the HTTP container doesn't start processors and vice
   versa), or 2 API replicas behind Caddy (repeatable jobs are de-duplicated by BullMQ; boot-time
   jobs — partition ensure, heatmap backfill — are idempotent, but check them first).
4. **Hot rows.** `UPDATE "Variant" SET reserved = reserved + $1 … WHERE stock - reserved >= $3`
   was the top statement under checkout (mean 3.8 ms incl. row-lock waits; only 14 variants in the
   seed). With a real catalogue contention spreads out; a single hit product during a promo
   serialises on its row — acceptable at 20 orders/s, watch it in `pg_stat_statements`.
5. **Per-request lookups.** The `Integration` table was read ~1 500 times in the 40 rps browse
   run (≈ once per API request) — cache integration rows in memory for a few seconds.
6. **Database is not the limit** at this size: every catalogue query < 1 ms mean, search (trigram,
   GIN index present) 0.8–3 ms. No new index needed now; when reviews grow, an index on
   `Review(productId, status, createdAt)` matches the product reviews query.
7. Re-run on staging with production-like hardware and the real catalogue before launch; record the
   numbers here.
