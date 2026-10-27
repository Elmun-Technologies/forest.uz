# Runbook · Messaging (Eskiz SMS), Telegram login, fiscal receipts, BTS manual mode

Code:
- Eskiz: `apps/api/src/integrations/providers/eskiz.ts` (protocol, token cache, callback parsing),
  `apps/api/src/messaging/*` (callback webhook), wiring in `integrations.service.ts` (`sms()`).
- Telegram login: `apps/api/src/customer/auth/telegram-login.ts` (hash check),
  `telegram-auth.service.ts`, `auth.controller.ts`; health check `integrations/providers/telegram.ts`.
- Fiscal: `apps/api/src/commerce/fiscal.service.ts`, rule in `order-lifecycle.service.ts`
  (`transition` → COMPLETED), `integrations/providers/manual-fiscal.ts`.
- BTS: `apps/api/src/delivery/manual-shipment.service.ts`, `integrations/providers/bts-manual.ts`,
  `OrderLifecycleService.advanceForDelivery`, delivery state machine in
  `packages/contracts/src/order-state.ts`.

Tests: unit `eskiz.test.ts`, `telegram-login.test.ts`, `telegram.test.ts`, `delivery-steps.test.ts`,
contracts `order-state.test.ts`; integration `test/eskiz.int.test.ts` (local Eskiz stub server),
`test/telegram-auth.int.test.ts`, `test/fiscal-bts.int.test.ts`.

## Source of truth (2026-10-27)
`notify.eskiz.uz`, `documenter.getpostman.com`, `core.telegram.org` are blocked from the dev
environment. Protocols were built only from these downloaded sources (read, never executed),
cross-checked against each other and against search-engine snippets of the official pages.

| Topic | Source (exact version) | Used for |
|---|---|---|
| Eskiz | **Official Postman collection export** "СМС шлюз от Eskiz.uz" (`_postman_id a7ee11d4-f6ea-4dc6-93d7-135dde184cb0`) mirrored at https://raw.githubusercontent.com/mlkvdev/eskiz-sms/5271156ee0ab11805c1f2623bb41403a6e514e96/docs/eskiz.uz.postman_collection.json | endpoints, form fields, response examples, callback body, status lists, test-account restriction |
| Eskiz | PyPI `eskiz-sms` 1.0.1 (https://files.pythonhosted.org/packages/af/13/fa6083bf5ddf2280490827b28d60c032336fd3829f2d5f0f2a55dd6dc601/eskiz_sms-1.0.1.tar.gz; repo mlkvdev/eskiz-sms @ `5271156`) — `eskiz/endpoints.py`, `_protocol/{auth,sms,_helpers}.py`, `auth/token.py`, `transport/base.py`, `_validators.py`, `models/sms.py` | base URL `https://notify.eskiz.uz/api`, form-encoded login/send, `data.token`, single-flight refresh, 401 handling, phone = digits only |
| Eskiz | npm `eskiz-sms` 1.4.1 (https://registry.npmjs.org/eskiz-sms/-/eskiz-sms-1.4.1.tgz; repo mdotme/node-eskiz-sms) — `dist/eskiz-sms.js`, `dist/types/*.d.ts` | same endpoints/fields (JSON body variant), 401 → re-login with a queue, status enum `new/stored/accepted/partdelivered/delivered/rejected` |
| Eskiz | npm `@joyida/eskiz` 0.2.1 (https://registry.npmjs.org/@joyida/eskiz/-/eskiz-0.2.1.tgz) — `dist/eskiz.js`, `dist/types.d.ts` | multipart form login/send, callback parser (JSON, else urlencoded), callback fields `request_id, message_id, user_sms_id, country, phone_number, sms_count, status, status_date`, statuses `DELIVRD/REJECTED/EXPIRED/UNDELIV` |
| Eskiz | GitHub parmonov98/laravel-eskiz @ `d4c0c040f8cce425c533a324dc77841bc2e1ed1e` (packagist v1.1.0) — `src/LaravelEskiz.php`, `config/laravel-eskiz.php` | only as a weak cross-check of paths and field names (`mobile_phone`, `message`, `from`, `callback_url`); the package is unfinished (debug `dd()` calls) and was not trusted for anything else. `uzbek/laravel-sms` was not reachable. |
| Telegram login | PyPI `aiogram` 3.31.0 — `aiogram/utils/auth_widget.py` | data-check-string, secret = SHA256(token), HMAC-SHA256 hex |
| Telegram login | PyPI `social-auth-core` 6.2.0 — `social_core/backends/telegram.py` | same algorithm; constant-time compare; reject line feeds in values; `auth_date` older than 86 400 s rejected |
| Telegram Bot API | aiogram 3.31.0 `client/telegram.py`, `methods/get_me.py` | `https://api.telegram.org/bot<token>/getMe` health check |

Search snippets of core.telegram.org/widgets/login-legacy confirm the widget fields (`id, first_name,
last_name, username, photo_url, auth_date, hash`) and the algorithm. The same search shows Telegram
now calls this page "login-legacy" and documents a newer "Log In With Telegram" (OpenID Connect,
core.telegram.org/bots/telegram-login) — not implemented, open question 53.

## Eskiz SMS
**Protocol (all sources agree):**
- `POST {base}/auth/login` with `email`, `password` (the API secret key from my.eskiz.uz) as form
  fields → `{ "message": "token_generated", "data": { "token": "…" }, "token_type": "bearer" }`.
- `POST {base}/message/sms/send`, `Authorization: Bearer <token>`, form `mobile_phone=998XXXXXXXXX`
  (digits only), `message`, `from` (nickname), optional `callback_url` →
  `{ "id": "<uuid>", "message": "Waiting for SMS provider", "status": "waiting" }`.
  We store `id` as `Message.providerId`; the callback's `request_id` is that id (Postman text).
- HTTP 401 = token expired/invalid → log in again (npm and PyPI SDKs both do this).
- Callback = POST to `callback_url` with `{request_id, message_id, user_sms_id, country,
  phone_number, sms_count, status, status_date}`; no signature in any source.
- Statuses: per message `NEW, STORED (callback only), ACCEPTED, PARTDELIVERED, DELIVERED, REJECTED`;
  per part `NEW, ACCEPTED, DELIVRD, UNDELIV/UNDELIVERABLE, EXPIRED, REJECTD, DELETED, UNKNOWN,
  ENROUTE` (Postman description). Our mapping: `DELIVRD/DELIVERED/PARTDELIVERED` → `DELIVERED`;
  `UNDELIV/UNDELIVERABLE/EXPIRED/REJECTD/REJECTED/DELETED` → `FAILED` (error `eskiz: <status>`);
  anything else = not final, ignored.

**Our design (CLAUDE.md §6):**
- Credentials in admin → Integrations → Eskiz: `email`, `password` (secret key), `from`. Connect
  runs the health check = a real login. On first connect a 32-byte random `callbackToken` is
  generated and stored encrypted with the credentials (never shown); disconnect drops it.
- Token cache in Redis `eskiz:token:<sha256(email)>`: TTL = JWT `exp` − 1 h (fallback 24 h − 1 h);
  one login at a time (in-process promise + Redis `SET NX PX 10 s` lock, other processes wait for the
  token); on 401 the failed token is dropped (compare-and-delete) and the send retried **once**.
- Sends are never retried on 5xx/timeouts (no idempotency key in the API — a retry could double the
  SMS). Logins are retried (no side effects).
- Callback URL sent with every SMS: `${API_URL}/v1/webhooks/eskiz/<callbackToken>`. Wrong/missing
  token or disconnected integration → 404. Authenticated callbacks always get 200 (unknown ids,
  junk and non-final statuses are acknowledged and ignored). Final states are never overwritten;
  `deliveredAt` is set once. Payloads go to `IntegrationLog` redacted (phones masked). A final
  status for an id we haven't stored yet is parked in Redis (`eskiz:cb:<id>`, 10 min) and applied
  when the sender stores `Message.providerId`. Access logs mask the token (`/webhooks/eskiz/***`).
- Templates: every key the API sends is inserted by migration `message_templates_backfill`
  (`ON CONFLICT DO NOTHING`, seed texts); a missing/inactive template is skipped with one warning
  per key per process.
- OTP texts are not stored in `Message` (secrets), so their callbacks are "unknown" — expected.
- `ESKIZ_API_URL` (env, default `https://notify.eskiz.uz/api`) exists only so tests can point the
  adapter at a stub; the password is sent there, so it is not an admin field.
- Fake provider stays the default with `PROVIDERS_MODE=fake`; in sandbox/live an unconnected Eskiz
  throws `INTEGRATION_NOT_CONFIGURED` (OTP send fails loudly instead of pretending).

**Not verified (open questions 48–52):** token lifetime; callback content type, IPs, signature,
which statuses are posted and retry policy; `id` = `request_id` on the production account; Cyrillic
SMS rules/cost; template approval for the new `{trek}`/`{filial}` slots. Eskiz requires pre-approved
templates for every text (q.19, pitfall in CLAUDE.md §17).

## Telegram login (`POST /v1/auth/telegram`, `POST /v1/me/telegram/link`)
- Body = the widget's `onauth` object (or the redirect query as JSON). All fields except `hash` are
  part of the check, so unknown fields are kept; keys `[a-z_]`, ≤ 20 fields; `hash` 64 hex.
- `data_check_string = sorted("key=value" for every field except hash).join("\n")`,
  `secret = SHA256(botToken)`, `hash == hex(HMAC_SHA256(secret, data_check_string))` (constant
  time). Values containing `\n` are rejected. `auth_date` must be ≤ 24 h old and ≤ 5 min in the
  future. 10 requests/min per IP (both endpoints share the limit).
- Bot token and username come from the CONNECTED `telegram` integration (any `PROVIDERS_MODE`;
  inbound auth, like the payment webhooks). Not connected → 503 `INTEGRATION_NOT_CONFIGURED`.
  `GET /v1/settings/public` → `auth.telegramBot` = the configured bot username, or `null` (the
  storefront hides the widget). Connect in sandbox/live runs `getMe` and requires the username to
  match.
- Login: customer by `telegramId` (created on first login, name from first/last name, no phone,
  `leadSource = telegram_login`), session exactly like OTP (rotation, anonymous cart merge).
  `/me` returns `phone: null` and `telegram: { username }`.
- Link (any customer session): attaches the Telegram id; a phone-less, order-less Telegram-only
  holder is absorbed (active cart merged, addresses, favourites, consents, visitors, messages,
  conversations and notes move; stub erased; its sessions revoked via `sess:revoked:<customerId>`;
  `AuditLog customer.telegram_merged`); any other holder → 409 `TELEGRAM_ALREADY_LINKED`.
- No replay protection on widget payloads beyond the 24 h `auth_date` window: the widget may
  hand back the same signed payload on a legitimate re-login, which a one-use rule would break
  (unverifiable while core.telegram.org is blocked — revisit with q.53).
- Checkout still requires a phone in the body and attaches the order to that phone's customer — an
  unverified phone is never written onto a Telegram account.
- Errors: 401 `TELEGRAM_AUTH_INVALID` (bad hash / another bot / malformed), 401
  `TELEGRAM_AUTH_EXPIRED` (stale or future `auth_date`), 400 `VALIDATION_FAILED` (shape).
- Setup: BotFather `/setdomain` → the shop domain; admin → Integrations → Telegram: `botToken`,
  `botUsername` (`adminChatId` optional until the bot/alerts in Phase 5).

## Fiscal receipts
- Rule (enforced in `OrderLifecycleService.transition`): **an order can become COMPLETED only with
  fiscal evidence**, else 409 `FISCAL_RECEIPT_REQUIRED`. Evidence = (1) a `FiscalReceipt` row
  (kind SALE) — manual operator entry or a future OFD adapter; (2) the PAID payment's
  `fiscalReceiptUrl`; (3) a PAID **Payme** payment whose `CreateTransaction` happened while the
  cashbox sent the receipt `detail` (`providerData.fiscalDetail = true`; Payme fiscalizes it).
  Click is not assumed to fiscalize (q.34/56) → manual receipt or URL.
- DELIVERED is not gated: COD receipts are printed at the door and entered afterwards.
- `FiscalService.recordManualReceipt(orderId, { receiptUrl?, receiptNumber? }, staffId, ip?)`:
  at least one; https links only (≤ 500 chars), numbers `[\w-/.: ]{1,64}`; cancelled orders refused;
  re-entry corrects the receipt (one SALE receipt per order). Writes OrderEvent `FISCAL_RECEIPT` and
  AuditLog `order.fiscal_receipt_recorded|corrected` (before/after). Admin UI + RBAC: Phase 3.
- `integrations.fiscal()` → `ManualFiscalProvider` outside fake mode (`issueReceipt` → `null` =
  "operator records it"); a real OFD adapter replaces it once q.3 is decided.
- `OrderLifecycleService.completeOrder(orderId, actor)` closes an order (Phase 3 admin action).

## BTS — manual mode
- No API calls (partner docs missing, q.11/58). `integrations.delivery('bts')` returns
  `BtsManualDeliveryProvider` outside fake mode (zone prices; `getState` throws "manual mode").
- `ManualShipmentService.setManualShipment(orderId, { trackNumber?, branch?, status, note? }, staffId)`:
  only BTS orders (`SHIPMENT_CARRIER_MISMATCH`), only confirmed/paid ones (`SHIPMENT_ORDER_NOT_READY`
  for NEW/CANCELLED); track number required (4–40 letters/digits/dashes) and becomes
  `Shipment.trackNumber` + `externalId`; status must follow the delivery state machine
  (`DELIVERY_INVALID_TRANSITION`; an initial entry may skip CREATED). Same status + same data = no-op.
- Each change appends to `Shipment.history` (`{at, status, place?, note?}` — shown on the tracking
  page), writes OrderEvent `DELIVERY_STATUS`, and `advanceForDelivery` walks the order
  (PICKED_UP/IN_TRANSIT/AT_BRANCH ⇒ HANDED_TO_COURIER via PACKING/READY; DELIVERED ⇒ DELIVERED;
  RETURNED ⇒ RETURNED; one STATUS_CHANGED event per step, actor = the operator).
- SMS after commit: handed over (entry PICKED_UP / IN_TRANSIT / AT_BRANCH) → `order_shipped_bts`
  (`{trek}`), at branch → `order_at_branch` (`{filial}`), delivered → `order_delivered`, failed →
  `order_delivery_failed` only when the order is HANDED_TO_COURIER (BTS had the parcel) and at most
  once per shipment (`DELIVERY_NOTICE` marker). A first entry straight to DELIVERED / RETURNED never
  sends "shipped". In-transit scans are silent. RETURNED releases the stock hold.

## Telegram bot (5A, docs/09, CLAUDE.md §6 "Telegram bot")

Code: `apps/api/src/bot/*` (grammY **1.46.0**, exact pin), admin `apps/api/src/admin/bot/*`, UI
`apps/admin/src/app/(panel)/bot/*`, storefront `/c/<token>` + `/tg`. Tests: `test/telegram-bot.int.test.ts`
(fake transport, flows 1–5, webhook secret, cart restore, commands, inbox RBAC), unit `bot/cart-link.test.ts`,
`packages/contracts/src/bot.test.ts`, e2e `tests/bot-cart-restore.spec.ts`, `tests/admin-bot.spec.ts`.

Sources (core.telegram.org is blocked from dev; cross-checked):
| Point | grammY 1.46.0 / `@grammyjs/types` 5.0.0 | python-telegram-bot 21.6 / 22.0 | telegraf 4.16.3 |
|---|---|---|---|
| Webhook auth header `X-Telegram-Bot-Api-Secret-Token`, `secret_token` 1–256 chars `[A-Za-z0-9_-]` | `methods.d.ts setWebhook`, `convenience/frameworks.js` | `Bot.set_webhook`, `ext/_utils/webhookhandler.py` | `lib/telegraf.js` (`TOKEN_HEADER`) |
| File download `https://api.telegram.org/file/bot<token>/<file_path>` after `getFile`, ≤ 20 MB | `methods.d.ts getFile` | `Bot(base_file_url=…)` | — |
| `contact.user_id` (own number check) | `message.d.ts Contact` | `_files/contact.py` | — |
| 403 = bot blocked by the user | `GrammyError.error_code` | `request/_baserequest.py` → `Forbidden` | — |
| `copy_text` inline button | `markup.d.ts InlineKeyboardButton` | 22.0 `inlinekeyboardbutton.py` | — |

Operation:
- Connect in A10 (Owner): bot token, username, optional admin group chat id. Connect generates
  `webhookSecret` (encrypted with the credentials) and calls `setWebhook` (`allowed_updates`
  message, callback_query, my_chat_member); a failure is logged as IntegrationLog `webhook.set`
  (ok=false) and raises an admin alert. Reconnect after a disconnect = new secret + new webhook.
- Updates: `POST /v1/webhooks/telegram/<secret>` + header; deduped per `update_id` (Redis 24 h),
  handled in-request (per-chat order), always 200 once authenticated.
- Fake mode: every Bot API call goes to `FakeTelegramTransport` (no network); dev endpoints
  `POST /v1/dev/bot/update {chatId, text|callback}`, `GET /v1/dev/bot/sent?chatId=`,
  `POST /v1/dev/bot/cart-link` simulate the bot locally; sent texts also show in `/v1/dev/outbox`.
- Unverified / owner decisions: open questions 98–102.

## Before go-live checklist
- [ ] Eskiz account activated, nickname approved, all templates approved (q.19, 48–49); connect in
      admin (login test green); send one OTP and one order SMS to a staff phone; see `DELIVERED`
      appear on the `Message` row (callback reaches `https://<API_DOMAIN>/v1/webhooks/eskiz/…`).
- [ ] Telegram bot created, `/setdomain` set, integration connected (`getMe` green); widget login on
      the production domain; link from the cabinet.
- [ ] Fiscal: COD receipt process agreed with the accountant (q.3, 57); Payme receipt visible in the
      Payme cabinet for a test payment (q.55); Click decision (q.56).
- [ ] BTS: operator procedure for waybill entry and statuses (q.58) until the API exists.

## Incident notes
- "SMS not arriving": `IntegrationLog` (`eskiz`, `webhook.status`) and the `Message` row (`status`,
  `error = eskiz: UNDELIV|REJECTD…`). REJECTD usually = blacklisted number; EXPIRED = phone offline
  24 h (Postman notes). Token problems show as repeated 401s → reconnect (re-enter the secret key).
- "Telegram login fails for everyone": bot token rotated in BotFather → update the integration;
  username mismatch → connect reports it; clock skew on the server → `TELEGRAM_AUTH_EXPIRED`.
- "Cannot complete order": record the fiscal receipt first (`FISCAL_RECEIPT_REQUIRED`).
