# 06 · Integrations

> **Rule for Claude Code:** the protocol notes below are a starting point written from general knowledge. Before implementing any provider, **read its current official documentation** (WebFetch/WebSearch) and follow it over this file. Where docs are private (BTS, OFD), build the adapter interface + `fake` implementation + manual admin fallback, and list what's missing in `docs/13-open-questions.md`.

## Integration framework (build first)
```ts
interface IntegrationDefinition {
  key: string;                 // 'payme'
  category: 'payment'|'delivery'|'erp'|'crm'|'feed'|'fiscal'|'messaging'|'ads'|'seo'|'automation';
  fields: FieldDef[];          // credentials/config form rendered in admin A10 (secret fields masked)
  launchKit: boolean;          // required before go-live
  test(ctx): Promise<HealthResult>;
  status: 'available'|'coming_soon';
}
```
- Registry drives admin A10 (cards, filters, detail panel, launch-kit progress). Adding an integration = add a definition + adapter; no UI work.
- Credentials encrypted in `Integration.credentials`; only Owner edits; every change → `AuditLog`.
- Each provider has `fake` mode used automatically when not connected (local/staging/tests).
- All calls through a resilient HTTP client: timeouts, retries (idempotent only), circuit breaker, `IntegrationLog` with redacted payloads.

## Launch kit (must be green before production launch)
Payme · Click · COD · Yandex Delivery · BTS · MoySklad · Fiscal (OFD) · IKPU catalog complete · Telegram bot · Eskiz SMS · Google Search Console · Yandex Webmaster.

---

## Payments

### Payme — Merchant API (we are the server)
> Implemented (Phase 2). The verified protocol details, pinned official sources, deviations and unverified points are in `docs/runbooks/payments.md` — it supersedes the notes below for Payme and Click.
- Payme calls `POST /webhooks/payme` with JSON-RPC 2.0. Auth: `Authorization: Basic base64("Paycom:<merchant key>")`. Wrong auth → error `-32504`. Optionally restrict by Payme IPs.
- Methods to implement: `CheckPerformTransaction`, `CreateTransaction`, `PerformTransaction`, `CancelTransaction`, `CheckTransaction`, `GetStatement` (+ `ChangePassword` if required).
- Account field: `order_id` (our `Order.id` or number — pick one, be consistent). Amount in **tiyin**.
- Transaction states: `1` created, `2` performed, `-1` cancelled before perform, `-2` cancelled after perform. Timeout: created transaction older than 12 h must be cancelled (reason 4).
- Common errors: `-31001` wrong amount, `-31003` transaction not found, `-31008` cannot perform, `-31050…-31099` order/account errors (not found, already paid, cancelled).
- **Fiscalization:** return `detail` with receipt items in `CheckPerformTransaction` (`items[]: title, price, count, code (IKPU), package_code, vat_percent`, plus shipping line). Verify exact field names in current docs.
- Checkout redirect: `https://checkout.paycom.uz/<base64("m=<merchant_id>;ac.order_id=<id>;a=<tiyin>;c=<return_url>;l=uz")>`; sandbox: `test.paycom.uz` (use Payme sandbox to run the official test scenarios before going live).
- Refund: cancel performed transaction (`-2`) from admin (Payme cabinet/API per docs).

### Click — SHOP API (we are the server)
- Two endpoints: `prepare` (action=0) and `complete` (action=1), `application/x-www-form-urlencoded`.
- Signature: `md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + [merchant_prepare_id for complete] + amount + action + sign_time)` → compare with `sign_string`.
- Respond with `click_trans_id, merchant_trans_id, merchant_prepare_id|merchant_confirm_id, error, error_note`. Error codes: `0` ok, `-1` sign failed, `-2` wrong amount, `-3` action not found, `-4` already paid, `-5` order not found, `-6` transaction not found, `-7` update failed, `-8` request error, `-9` cancelled.
- Payment link: `https://my.click.uz/services/pay?service_id=&merchant_id=&amount=&transaction_param=<orderId>&return_url=`.
- Fiscal data for Click payments: via Click's fiscalization API (IKPU per item) — check docs / merchant manager.

### COD (cash/card to courier)
- Status `COD_PENDING` until operator marks courier settlement → `PAID`.
- Fiscal receipt required → via OFD/online cash register provider (see Fiscal).

### Coming soon (registry status `coming_soon`): Uzum Bank, Paynet, Octo (Visa/Mastercard), Uzum Nasiya, Alif Nasiya.

## Fiscal (OFD / soliq)
- `FiscalProvider` interface: `issueReceipt(order, payment) → {receiptId, url, qr}`; `refundReceipt(...)`.
- Payme/Click online payments: fiscalized by the payment provider using IKPU data we send.
- COD: provider `[confirm with accountant]` (virtual cash register / courier POS). MVP fallback: `manual` provider — operator pastes receipt link/number in order; order cannot be `COMPLETED` without a receipt.
- Every `Variant` requires IKPU (MXIK) + package code + VAT %; admin shows "IKPU kodi yo'q: N" KPI (A11).

## Delivery

### Yandex Delivery (Tashkent express, 12 h)
> Implemented (Phase 2): sources, request/response fields, status mapping, unverified points and the go-live checklist are in `docs/runbooks/delivery.md` — it supersedes the notes below.
- B2B Cargo/Express API (OAuth bearer token). Typical flow: `check-price` (quote) → `claims/create` → `claims/accept` → status via `claims/info` polling/callback → `cancel`. Courier info & position for tracking page.
- Quote used in checkout if live quote enabled; otherwise zone price from settings.
- "Call courier" button in A7 creates the claim when order is `READY`.
- Verify current endpoints, Uzbekistan availability and tariffs in Yandex Delivery docs/contract.

### BTS Express (regions, 24 h)
- Partner API docs must be requested from BTS (`[open question]`). Adapter methods: `getTariff`, `getBranches`, `createShipment` (door/branch), `getLabel`, `track`.
- Fallback until API: operator enters waybill/track number in A7; tracking page shows manual statuses; nightly job polls if any public tracking endpoint exists.

### Google Maps
- Places Autocomplete + map pin in checkout (mobile). Browser key restricted by HTTP referrer; server geocoding key separate.

## Inventory — MoySklad (JSON API 1.2)
- Base `https://api.moysklad.ru/api/remap/1.2`, bearer token, **gzip required** (`Accept-Encoding: gzip`), respect rate limits (per-account request window and parallel limit — check docs) → queue with concurrency 2 and backoff on 429.
- Pull: `entity/product`, `entity/variant`, `entity/bundle` (or `entity/assortment`), stock via `report/stock/all` (or by store), prices from `salePrices` (price type "Chakana" configurable).
- Push: `entity/counterparty` (customer by phone), `entity/customerorder` (with positions, reserve, state, delivery/payment attributes), update state on paid/shipped/cancelled.
- Webhooks: register via `entity/webhook` for product/variant CREATE/UPDATE/DELETE and stock changes (or poll stock every N minutes if webhooks don't cover it).
- Field mapping (A13 default): name ↔ `product.name`, SKU ↔ `article`, IKPU ↔ custom attribute `ikpu`, price ↔ `salePrices[Chakana]`, stock ↔ `stock − reserve`, order number ↔ `customerorder.name`, phone ↔ `counterparty.phone`, delivery method ↔ attribute `dostavka`.
- Hourly reconciliation; conflict rules from `02-business-rules.md`.
- Alternatives in registry: 1C, Billz (`available` but not built in MVP).

## Messaging

### Telegram Bot API
- Webhook `POST /webhooks/telegram` with `secret_token`; framework: **grammY** inside NestJS `bot` module.
- Login Widget / Mini-app auth hash verification for "Telegram orqali kirish".
- Admin alerts group (env `TELEGRAM_ADMIN_CHAT_ID`).
- Spec: `09-telegram-bot.md`.

### Eskiz (SMS)
> Implemented (Phase 2): sources, verified/unverified points and our token/callback design in `docs/runbooks/messaging-and-fiscal.md` (supersedes the notes below; Telegram login, fiscal manual provider and BTS manual mode are documented there too).
- `POST https://notify.eskiz.uz/api/auth/login` → token (refresh before expiry); `POST /api/message/sms/send` (`mobile_phone` 998XXXXXXXXX, `message`, `from`, `callback_url`).
- **SMS texts must be pre-approved templates** in Eskiz — keep templates fixed (OTP, order status, cart, review) and submit them early.
- Playmobile: backup `SmsProvider`.

### Coming later: WhatsApp, Instagram Direct (Meta), Chatplace.

## Ads & signals (analytics source of truth stays first-party)
| Platform | What we send | How |
|---|---|---|
| Meta | Pixel (browser) + **Conversions API** (server): PageView, ViewContent, AddToCart, InitiateCheckout, Lead, Purchase; same `event_id` for dedupe; hashed phone (SHA-256 of E.164 digits), `fbp/fbc`, IP, UA; currency `UZS` | Graph API `/{pixel_id}/events` |
| Meta | Product catalog feed, Custom Audiences (hashed phones, consented only) | feed URL + Marketing API |
| Google Ads | gtag conversion + **offline/enhanced conversions** with gclid, Customer Match | Google Ads API (developer token needed) |
| Google Merchant | product feed | feed URL |
| TikTok | Pixel + Events API, catalog | Events API |
| Yandex Metrika | counter **only** for Yandex Direct optimization + offline conversions; Yandex Audiences | Metrika/Audience APIs |
- Ad spend import (daily) from Meta/Google/TikTok/Yandex APIs → `AdSpendDaily` → ROAS in A2.
- Consent: ad-matching only for customers with `ADS_MATCHING` consent; browser pixels load only after marketing cookie consent.
- GTM and GA4: optional toggles (off by default).

## SEO tools
- Verification meta tags stored in settings and rendered in `<head>`: `google-site-verification`, `yandex-verification`, `msvalidate.01`.
- Search Console API (search analytics, sitemaps), Yandex Webmaster API (queries, indexing), IndexNow (Yandex/Bing) on publish/update.
- Cloudflare: DNS/CDN/TLS/WAF; cache rules for images & static; never cache API/HTML with personal data.

## Automation & AI
- Outbound webhooks (`order.created`, `order.paid`, `order.shipped`, `cart.abandoned`, `customer.created`, `stock.low`), signed; REST API keys for n8n/Make/Zapier.
- AI (Anthropic Claude via API, model in env): product description drafts UZ/RU, SEO title/description suggestions ("AI bilan taklif"), operator reply drafts in bot inbox. Human approves before publish. Server-side keys only; log token usage.
- OpenAI: alternative provider behind the same `AiProvider` interface.
