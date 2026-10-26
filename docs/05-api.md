# 05 · API conventions & endpoints

## Conventions
- Base: `https://api.forest.uz/v1`. JSON, camelCase. Money as integer **so'm** in public API responses (`priceUzs`), tiyin internally only.
- Request/response schemas = zod in `packages/contracts`; Nest uses a `ZodValidationPipe`. OpenAPI generated (`@anatine/zod-openapi` or nestjs-zod) at `/v1/docs` (admin-auth only in prod).
- Errors: RFC 7807-like `{ "error": { "code": "PROMO_FIRST_ORDER_ONLY", "message": "<localized>", "field": "promoCode" } }`. Codes are stable enums; messages localized by `Accept-Language`.
- Locale: `Accept-Language: uz|ru` or `?locale=`.
- Auth:
  - Customer: httpOnly secure cookie `fr_session` (opaque session id in Redis, 90 days sliding). No JWT in localStorage.
  - Admin: separate cookie `fr_admin` on admin domain, 12 h, TOTP step-up; RBAC guard `@Roles()` + permission map.
- Idempotency: `Idempotency-Key` header required on `POST /checkout/orders` and refunds.
- Rate limits (Redis): OTP send 1/60 s per phone, 5/h per IP; checkout 10/min per IP; tracker ingest 300 events/min per session.
- Pagination: cursor-based `?cursor=&limit=` → `{ items, nextCursor }`.
- Webhooks in: dedicated controllers, raw body, signature/auth verified **before** parsing, respond fast, process async via queue, idempotent.
- Webhooks out: HMAC-SHA256 `X-Forest-Signature: t=<ts>,v1=<hex>`, retries with exponential backoff (8 attempts), log in `IntegrationLog`.

## Public (storefront)
```
GET  /catalog/categories
GET  /catalog/products?category=&surface=&color=&volume=&priceMin=&priceMax=&brand=&sort=&cursor=
GET  /catalog/products/:slug
GET  /catalog/search?q=            # autocomplete; logs zero-result queries
POST /catalog/calculator           # {productId, areaM2, coats} → liters + recommended variants
POST /catalog/waitlist             # {variantId, phone|telegram}

GET  /cart                         # by cookie (anonymous) or session
POST /cart/items                   # {variantId, qty}
PATCH /cart/items/:variantId       # {qty}
DELETE /cart/items/:variantId
POST /cart/promo                   # {code} → applied | localized error
DELETE /cart/promo
GET  /cart/quote?region=&district= # shipping options & ETA

POST /checkout/orders              # contact, address, deliveryMethod, paymentMethod, consent{offerVersion}
                                   # → {orderNumber, publicId, next: {type:"redirect", url} | {type:"cod"}}
GET  /orders/:publicId             # order received page (limited fields)
GET  /track/:token                 # tracking page, no auth
PATCH /track/:token/address        # allowed until HANDED_TO_COURIER (OTP-confirmed)

POST /auth/otp/send                # {phone}
POST /auth/otp/verify              # {phone, code} → session cookie, cart merge
POST /auth/telegram                # Telegram Login widget payload (hash verified)
POST /auth/logout

GET  /me                           # profile, consents
GET  /me/orders · POST /me/orders/:id/repeat
GET/POST/DELETE /me/addresses · /me/favorites
POST /me/reviews                   # verified purchase only, multipart photos, photoConsent
PATCH /me/consents
POST /me/data-export · POST /me/data-delete

POST /leads                        # {phone, source:"popup"|"selector"|..., promo:"SALOM10"} → SMS code / bot deep link
GET  /content/pages/:kind/:slug    # legal, articles
GET  /content/home                 # blocks, bestsellers, gallery, faq
GET  /settings/public              # delivery texts, cut-off, thresholds, contacts, verification meta tags

POST /t                            # analytics batch ingest (see 07)
POST /t/replay                     # rrweb chunks (consented sessions, sampled)
```

## Webhooks (inbound)
```
POST /webhooks/payme               # JSON-RPC Merchant API (Basic auth "Paycom:<key>")
POST /webhooks/click/prepare       # SHOP API action=0 (md5 sign_string)
POST /webhooks/click/complete      # SHOP API action=1
POST /webhooks/yandex-delivery     # claim status callbacks (if enabled) + polling fallback
POST /webhooks/bts                 # if BTS provides callbacks; else polling job
POST /webhooks/moysklad            # entity change notifications
POST /webhooks/telegram            # Bot API updates (X-Telegram-Bot-Api-Secret-Token)
POST /webhooks/eskiz               # SMS delivery status callback
```

## Admin (`/v1/admin/*`, RBAC)
```
auth: login, totp/setup, totp/verify, logout, me
dashboard: GET /admin/dashboard?range=   # KPIs, alerts, funnel, sources, latest orders, top products
analytics: realtime, sources(utm), landing/exit, events-goals, devices-geo, cohorts, ad-spend
heatmaps: GET /admin/heatmaps?path=&device=&type=click|scroll|move ; sessions list/filters; replay/:sessionId
customers: list/filter/search, :id (360: KPIs, journey timeline, orders, audiences, consents), notes, tags, export (OWNER), erase
orders: list/filter (status, payment, carrier, SLA), :id, transitions, call courier, print label, refund, notes, timeline
audiences: CRUD segments (rule tree), preview size, sync status per destination, automations
seo: meta CRUD by path/locale, ai-suggest, health, cwv, queries (GSC/YWM), sitemap regenerate, robots, redirects, 404s, schema toggles, verification codes
integrations: list/registry, :key (status, masked fields), connect/disconnect, test, logs; webhooks-out CRUD; api keys
products: CRUD, variants (content fields only; price/stock read-only when MoySklad connected), images, relations, channels (feeds), ai-describe
moysklad: status, run sync, flows toggles, field mapping, conflict rules, log
bot: flows toggles & stats, templates CRUD + test send, inbox (conversations, reply), settings (hours, operators, caps)
promo: codes CRUD + stats/suspicious, automatic promotions
reviews: list by state, approve/reject/reply, gallery order
settings: store, legal versions, delivery zones/rules, staff CRUD + roles, audit log
files: upload (signed URL), image variants
```

## Product feeds
```
GET /feeds/meta.xml · /feeds/google.xml · /feeds/tiktok.xml   # hourly cache, locale param, only ACTIVE + in-stock flags
GET /sitemap.xml (index) · /sitemaps/{uz,ru}-{products,categories,pages}.xml
GET /robots.txt (from settings)
```
