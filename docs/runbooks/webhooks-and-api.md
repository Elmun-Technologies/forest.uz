# Outbound webhooks, partner API keys, AI drafts

Phase 5C (CLAUDE.md §6). Admin: Integratsiyalar → "Webhook va REST API" (`/integrations/webhooks`,
`/integrations/api-keys`); content: "Ilhom va Brend" (`/content`).

## Outbound webhooks

**Who:** list and delivery log — Owner/Manager (`integrations.view`); create, edit, rotate secret,
send test, redeliver, delete — Owner (`integrations.keys`). Every change is in the audit log
(without the secret).

**Events** (`WEBHOOK_EVENTS` in `@forest/contracts`):

| Event | When (committed row the collector reads) |
|---|---|
| `order.created` | `OrderEvent` `CREATED` |
| `order.paid` | `OrderEvent` `PAYMENT_PAID` |
| `order.status_changed` | `OrderEvent` `STATUS_CHANGED` (`data.change = {from, to}`) |
| `order.shipped` | status change to `HANDED_TO_COURIER` |
| `order.delivered` | status change to `DELIVERED` |
| `order.cancelled` | status change to `CANCELLED` |
| `customer.created` | new `Customer` row |
| `review.approved` | audit row `review.moderate` with `after.status = APPROVED` |
| `webhook.test` | "Sinov yuborish" button only |

An endpoint gets only events created after it was added (no backfill).

**Request:** `POST <url>`, `Content-Type: application/json`, `User-Agent: Forest-Webhooks/1.0`.

```http
X-Forest-Event: order.paid
X-Forest-Delivery: cmabc123…            # same on every retry — use it to deduplicate
X-Forest-Signature: t=1793100000,v1=5f2c…  # HMAC-SHA256 hex
```

```json
{ "id": "cmabc123…", "type": "order.paid", "createdAt": "2026-10-27T10:00:00.000Z",
  "data": { "number": "F-10482", "status": "CONFIRMED", "paymentMethod": "PAYME",
            "paymentStatus": "PAID", "carrier": "YANDEX", "deliveryZone": "tashkent",
            "region": "tashkent", "district": "yunusobod", "subtotalUzs": 500000,
            "discountUzs": 0, "shippingUzs": 0, "totalUzs": 500000, "promoCode": null,
            "source": "web", "locale": "uz",
            "items": [{ "sku": "FR-CW-1000", "qty": 1, "priceUzs": 329000 }],
            "createdAt": "2026-10-27T09:58:00.000Z" } }
```

No PII: no names, phones, address lines, comments or review texts (open question 94).
`customer.created` data = `{id: "C-10001", locale, leadSource, createdAt}`; `review.approved` =
`{id, productSlug, rating, hasPhotos, createdAt}`.

**Verifying the signature (receiver):**

1. Split the header: `t=<unix seconds>`, then one or more `v1=<hex>`.
2. Reject when `|now − t| > 300` s (replay window).
3. `expected = hex(HMAC_SHA256(secret, "<t>.<raw request body>"))` — the raw bytes, before any
   JSON parsing.
4. Accept when any `v1` equals `expected` (constant-time compare).

Node example (same code as `apps/api/src/webhooks-out/signature.ts` `verifyWebhookSignature`):

```js
const [tPart, ...macs] = header.split(',');
const t = Number(tPart.slice(2));
if (Math.abs(Date.now() / 1000 - t) > 300) throw new Error('stale');
const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
const ok = macs.some((m) => m.startsWith('v1=') &&
  crypto.timingSafeEqual(expected, Buffer.from(m.slice(3), 'hex')));
```

**Delivery:** answer 2xx within 10 s (the body is ignored; redirects are not followed). Anything
else is retried: 8 attempts in total, waiting 30 s, 2 min, 10 min, 30 min, 1 h, 3 h, 6 h (≈ 11 h).
After the 8th failure the delivery is FAILED ("Qayta yuborish" queues it again). 5 FAILED
deliveries in a row switch the endpoint off (audit `webhook.auto_disabled`); switching it back on
resets the counter, and its queued deliveries resume. Every attempt is one IntegrationLog row
(`webhooks`, kind `webhook.<event>`, no payload).

**URLs:** production accepts only `https://` hosts that resolve to public addresses (checked when
saving and again before every send: no localhost, private, link-local or metadata addresses).

**Secret rotation:** "Kalitni yangilash" returns a new `whsec_…` once; the old one stops working
immediately (rotate during a quiet minute or accept a few failed attempts — they are retried).

## Partner REST API (API keys)

Base: `https://api.forest.uz/v1/partner` (or through the storefront: `https://forest.uz/api/partner`).
Header: `Authorization: Bearer fk_live_<prefix>_<secret>` (or `X-Api-Key`). Read-only.

| Endpoint | Scope | Notes |
|---|---|---|
| `GET /partner/products?limit=50&cursor=` | `products:read` | ACTIVE products: name/short description uz+ru, categories, image URLs, variants (SKU, label, `priceUzs`, `compareAtUzs`, `available`, `active`), storefront URLs. `{items, nextCursor}` |
| `GET /partner/products/:slug` | `products:read` | one product |
| `GET /partner/stock?sku=A,B` or `?limit=&cursor=` | `stock:read` | `available` = stock − open reservations (0 when the variant is inactive), ≤ 100 SKUs per call |

Errors: 401 `API_KEY_INVALID` (unknown, malformed or revoked key), 403 `API_KEY_SCOPE`,
429 `RATE_LIMITED` with `Retry-After`. Every response has `X-RateLimit-Limit` /
`X-RateLimit-Remaining` (per key, per minute, set when the key is created: 1–600, default 60).

Keys are shown once; only `sha256(key)` is stored (the key has 256 random bits). `lastUsedAt` is
updated at most once a minute. Revocation takes effect on the next request.

## AI drafts (Claude)

- Integration `claude` (Owner enters the API key; optional model — blank = `claude-opus-5-5`).
  Health check = `GET /v1/models/<model>` (no tokens spent).
- Adapter: `apps/api/src/integrations/providers/claude.ts`, official SDK `@anthropic-ai/sdk`
  **0.133.0** (pinned). Request: Messages API via `client.beta.messages.create` with
  `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'` (a classifier refusal is
  re-run on Anthropic's recommended model), `output_config: {effort: 'low', format: {type:
  'json_schema', schema}}` (structured JSON), `max_tokens` 4000, 60 s timeout, 1 SDK retry. No
  `temperature`/`top_p` and no `thinking` parameter (Opus 5.5 runs adaptive thinking; sampling
  parameters are rejected on newer API versions). A `refusal`/`max_tokens` stop or unparsable JSON
  → `AI_DRAFT_FAILED`.
- Endpoints (admin, POST, return drafts only — nothing is saved):
  `/admin/ai/product-description {productId, hint?}` (`products.edit`),
  `/admin/ai/seo {path}` (`seo.edit`; `/p/<slug>`, `/katalog/<slug>`, `/ilhom/<slug>`, `/`,
  `/katalog`, `/ilhom`, `/brend`), `/admin/ai/reply {conversationId, locale?}` (`bot.inbox`).
- Limits: 20 drafts/min per staff member, 300/day in total (`AI_DRAFT_LIMITED`). Each draft is
  audited `ai.draft` (kind, model, token counts) and logged in IntegrationLog `claude` (tokens).
- Prompts contain catalog/content facts only; reply drafts get the last ≤ 10 messages with phone
  numbers, emails, card-like digit runs, links and `F-`/`C-` ids replaced (`scrubPii`), never the
  customer's name (open question 93).
- `PROVIDERS_MODE=fake`: a fake returns schema-shaped `[AI fake] …` strings (the admin says so).

**Sources:** the claude-api skill bundled with Claude Code (model table cached 2026-10-06, TypeScript
SDK README, structured outputs and refusal-fallback sections) and the SDK 0.133.0 type
definitions (`BetaOutputConfig`, `BetaFallbacksParam = Array | 'default'`). Unverified until a real
key is connected: that this account has access to `claude-opus-5-5` and the fallback beta.

## Ilhom & Brend CMS

`/content` (Owner, Manager, Marketer — `content.edit`). Articles: UZ and RU are separate versions,
each with its own "saytda ko'rinadi" switch; a blank title removes that language. Blocks: heading,
paragraph, list, image (upload), quote, note, FAQ. Saving revalidates `/ilhom`, the article and the
sitemap at once (web `POST /api/revalidate`) and pings IndexNow. A slug change writes 301s for the
published languages. Brend page: only the "Bizning yo'l" story is CMS-managed (hidden until
published); the rest of the page is design copy in `apps/web/messages`.
