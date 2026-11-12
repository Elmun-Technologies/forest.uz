# Runbook · Payments (Payme, Click)

Code: `apps/api/src/payments/*` (webhooks), `apps/api/src/integrations/providers/{payme,click}.ts`
(pure protocol helpers + checkout link adapters), state changes in
`apps/api/src/commerce/order-lifecycle.service.ts`. Tests: `apps/api/test/payments.int.test.ts`,
`apps/api/src/integrations/providers/{payme,click}.test.ts`.

## Source of truth
**Since 2026-11-12 the official documentation is reachable and was checked against the code:**
- Payme — developer.help.paycom.uz: Merchant API methods (CheckPerformTransaction incl. the fiscal
  `detail` object, CreateTransaction, PerformTransaction, CancelTransaction, CheckTransaction,
  GetStatement) and "Отправка чека по методу GET/POST" (checkout link).
- Click — docs.click.uz (Docusaurus site; the page text lives in its JS bundles): SHOP API requests
  (Prepare/Complete), "Payment Button — With Redirection" (`my.click.uz/services/pay`), "Payment
  by Card" (`checkout.js` / `createPaymentRequest`), Merchant API → Data Fiscalization
  (`ofd_data/submit_items`, `submit_qrcode`, `GET ofd_data/:service_id/:payment_id`).
- Owner's notes from the providers (2026-11-12): Payme fiscal fields (title, price per unit in
  tiyin, count, code = MXIK, package_code, vat_percent; package code looked up at
  `https://tasnif.soliq.uz/attribute/<MXIK>`); Click manager's go-live instructions (below).

What the docs changed (commits `fix(payme): …`, `feat(click): …`):
- Payme CheckPerformTransaction may only answer `-31001` or the account range `-31050…-31099`, so
  order-state refusals moved from the template's `-31008` to `-31051` (already paid), `-31052`
  (cancelled / payment time over) and `-31053` (another transaction in progress), each with
  `data: "order_id"`. `-31008` stays for transaction-state errors (Create/Perform).
- Payme `detail.items[].package_code` is **required**: a receipt line without a real IKPU or package
  code means no `detail` (the order then needs a manual receipt) instead of a receipt Payme rejects.
- Click: fiscalization of paid orders is mandatory for shops with more than one IKPU → automated
  via the Merchant API (below). The hosted page link format is confirmed.

Initial implementation (2026-10-26, doc sites blocked from dev at the time) followed the providers'
**official GitHub repositories**, pinned to these commits:

| Provider | Repository @ commit | Files used |
|---|---|---|
| Payme | https://github.com/PaycomUZ/paycom-integration-php-template @ `889053cf5f0346fd9ddda0515676e45914b3df3c` | `README.md`, `Paycom/Application.php` (method semantics, result shapes), `Paycom/PaycomException.php` (error codes, `{ru,uz,en}` message), `Paycom/Merchant.php` (Basic auth), `Paycom/Order.php` (validation order), `Paycom/Transaction.php` (states, reasons, 12 h `TIMEOUT`, statement fields), `Paycom/Format.php` (ms timestamps), `Paycom/Request.php`, `Paycom/Response.php`, `paycom.config.sample.php` (login is always `Paycom`) |
| Payme | https://github.com/PaycomUZ/paycom-integration-java-template @ `9e92fc101aa666415be0692d492c9ac4de2d4f08` | `service/impl/MerchantService.kt`, `entity/OrderCancelReason.kt`, `entity/json/result/*.kt` (cross-check of the same semantics) |
| Click | https://github.com/click-llc/click-integration-php @ `1ca66fe4431153f477462fd7d3caedc388a9361e` | `README.md`, `click/models/BasicPaymentsErrors.php` (required fields, md5 sign, error codes/notes, check order), `click/models/BasicPaymentMethods.php` (prepare/complete responses), `click/models/Payments.php` + `BasePayments.php` (Merchant API base URL, `Auth` header, reversal) |
| Click | https://github.com/click-llc/click-integration-django @ `1af01d441da4d5418fdd1242659cee04e589fc1d` | `click/utils.py` (same checks), `click/forms.py` (legacy pay button), `click/__init__.py` |

Raw files: `https://raw.githubusercontent.com/<org>/<repo>/<commit>/<path>`.

## Endpoints (configure in the provider cabinets)
| Provider | URL | Notes |
|---|---|---|
| Payme cashbox "Endpoint" | `https://<API_DOMAIN>/v1/webhooks/payme` | JSON-RPC 2.0, always HTTP 200 |
| Payme cashbox account field | `order_id` (string) | value = our order number `F-10482` |
| Click Prepare URL | `https://<API_DOMAIN>/v1/webhooks/click/prepare` | form-urlencoded, JSON answer, HTTP 200 |
| Click Complete URL | `https://<API_DOMAIN>/v1/webhooks/click/complete` | |

Credentials are entered by the Owner in admin → Integrations (encrypted at rest), never env vars:
Payme `merchantId`, `key`, `testKey`, `mode` (test → `testKey` authenticates and checkout uses the
test host), `fiscalDetail` (on/off, default on), `allowedIps` (optional). Click `serviceId`,
`merchantId`, `merchantUserId` (needed for fiscalization), `secretKey`, `mode`, `fiscalize`
(on/off, default on), `shippingIkpu` / `shippingPackageCode` / `shippingVatPercent` (the delivery
service line on Click receipts; without them an order with paid delivery is not fiscalized by Click).

Data every receipt needs (both providers): each sold variant's **IKPU (MXIK, 17 digits)** and
**package code** (Admin → Mahsulotlar → variant; look the package code up on
`https://tasnif.soliq.uz/attribute/<MXIK>`), its VAT % (12 for a VAT payer, 0 otherwise), and the
company **STIR** (Admin → Sozlamalar → Do'kon → legal data; Click sends it as `CommissionInfo.TIN`).

## What is implemented (verified against the sources above)
**Payme** — every method of the template: `CheckPerformTransaction`, `CreateTransaction`,
`PerformTransaction`, `CancelTransaction`, `CheckTransaction`, `GetStatement`, `ChangePassword`.
- Auth `Authorization: Basic base64("Paycom:<key>")`, constant-time compare → else `-32504`.
- Errors: `-32504` privilege, `-32600` invalid request (missing `id`/`time`/`reason`), `-32601`
  method not found (`data` = method), `-32400` internal, `-31001` amount, `-31003` transaction not
  found, `-31007` cannot cancel, `-31008` cannot perform (transaction state), `-31050` account
  (`data: "order_id"`), `-31051` order already paid, `-31052` order cancelled / payment time over,
  `-31053` another transaction in progress (all three with `data: "order_id"`) — messages
  `{ru, uz, en}`.
- Validation order: amount numeric (`-31001`) → account (`-31050`) → amount equal to order total in
  tiyin (`-31001`) → order waiting for payment (`-31051` / `-31052`) → no other active transaction
  (`-31053`). A repeated `CreateTransaction` for a known transaction answers from the transaction's
  own state (stored result, or `-31008` once it is no longer created).
- States 1/2/-1/-2, reasons 1–5, 10. Created transactions expire after 43 200 000 ms (12 h, from
  our create time): on Create/Perform the transaction is cancelled with reason 4, then `-31008`.
- Repeated Create/Perform/Cancel return the stored result; concurrent calls are serialized by
  order → payment row locks (tests: 4× parallel Create, 6× parallel Perform → one payment).
- `GetStatement`: transactions whose Payme `time` is within `[from, to]`, all states, template fields.
- `ChangePassword`: re-encrypts the key in use (testKey in test mode), audit log `integration.secret_rotated`.

**Click** — `request_check` order: `-8` missing field → `-1` sign → `-3` action → `-5` order →
`-6` prepared transaction (complete) → `-4` already paid → `-2` amount → `-9` cancelled; `-7` when our
own write fails. Signature `md5(click_trans_id + service_id + SECRET + merchant_trans_id +
[merchant_prepare_id on complete] + amount + action + sign_time)`. Complete with `error < 0` from
Click rejects the attempt and answers `-9`. A repeated Complete after success answers `-4` (library
behaviour) without side effects. Amount (so'm decimal string) → tiyin only in `clickAmountToTiyin`.

## Business mapping (our decisions — CLAUDE.md §6)
- One `Payment` row per provider transaction; the checkout's PENDING row is bound to the first one.
- Payme `-1` (cancel before perform) → payment FAILED, order stays NEW until the reservation expires
  (the template cancels the order instead). Payme `-2` = refund: payment REFUNDED + `Refund`
  (`staffId = "provider:payme"`); if the order wasn't handed to the courier it is cancelled and stock
  released; HANDED_TO_COURIER / DELIVERED / COMPLETED → `-31007` (do a return first). Also `-31007`
  while a Yandex courier is dispatched (accepted claim) or any carrier holds the parcel — staff
  cancel the claim first (same rule for manual Click/COD refunds: `REFUND_NOT_ALLOWED`).
- Refunds: **Payme** — cancel the transaction in the Payme merchant cabinet; the resulting
  `CancelTransaction` records the refund. **Click** — reversal in the Click merchant cabinet, then
  record it with `OrderLifecycleService.recordManualRefund` (admin UI in Phase 3; full/partial).
  The official PHP library also shows a Merchant API reversal
  (`DELETE https://api.click.uz/v2/merchant/payment/reversal/{service_id}/{payment_id}`, header
  `Auth: <merchant_user_id>:sha1(<timestamp><secret_key>):<timestamp>`), but not whether its
  `payment_id` equals the `click_trans_id` we receive — so it is not automated yet.
- Orders are payable only by the method chosen at checkout (or switched via "pay again"); a COD order
  or a Payme order sent to Click answers "order not found" (`-31050` / `-5`).

## Click fiscalization (Merchant API)
Code: `apps/api/src/payments/click-fiscal.service.ts` (job `payments.click.fiscalize`, queue
`payments`, every minute), pure helpers in `integrations/providers/click.ts`
(`clickMerchantAuth`, `buildClickOfdPayload`), test `apps/api/test/click-fiscal.int.test.ts`
against a local stub of the Merchant API.
- For each Click payment PAID in the last 7 days without `fiscalReceiptUrl`:
  1. `GET https://api.click.uz/v2/merchant/payment/ofd_data/<service_id>/<click_paydoc_id>` — if
     Click already has a receipt (`qrCodeURL`), store it and stop (makes a crash after a submission
     harmless: nothing is filed twice).
  2. Otherwise `POST …/payment/ofd_data/submit_items` with `service_id`, `payment_id` =
     `click_paydoc_id` (from Prepare/Complete), `received_card` = total (tiyin) and one item per
     order line: `Name` (≤ 63 chars, Uzbek name + variant), `SPIC` (IKPU), `PackageCode`,
     `GoodPrice` (unit), `Price` (unit × qty), `Amount` (qty), `Discount`, `VAT` (VAT inside the
     discounted amount), `VATPercent`, `CommissionInfo {TIN: <store STIR>}` (or `PINFL`), plus a
     delivery line when delivery is charged. Header
     `Auth: merchant_user_id:sha1(timestamp + secret_key):timestamp`.
  3. The receipt link from step 1 is polled for up to an hour and saved as
     `Payment.fiscalReceiptUrl` → fiscal evidence (`payment_url`), so the order can be COMPLETED.
- Click errors back off 1 min → 6 h, 8 attempts, then `failed`. Missing data (IKPU, package code,
  seller STIR, delivery codes, totals mismatch) is recorded as the reason in
  `Payment.providerData.ofd` and re-checked hourly (settings may be filled in later); after 7 days
  the operator records the receipt manually (admin order page). Every terminal problem writes an
  IntegrationLog failure row (`click`, `fiscal.submit_items`), which the bot's integration-error
  alert picks up.
- Off switch: Click integration field `fiscalize = off` (e.g. if the merchant fiscalizes another way).
- Not used: `submit_qrcode` (for receipts printed by our own cash register — we have none online).

## Click go-live (manager's instructions, 2026-11-12)
1. Integration test with Click's test program (docs.click.uz → Merchant API → fiscalization tester).
2. merchant.click.uz → **Сервисы** → **Действия** on our service → enter the Prepare and Complete
   URLs (`https://<API_DOMAIN>/v1/webhooks/click/prepare|complete`), then ask Click to **activate**
   the service (it is created disabled).
3. Our server is not in the TAS-IX network → send Click the API **domain, IP address and port (443)**
   for their firewall whitelist **before the first real payment**. The IP must be **static**; warn
   Click before changing IP or domain (the Hetzner VPS IP 2.29.137.243 is static; a later move to a
   UZ VPS needs a new whitelist request first).
4. Test: install Click Up, open
   `https://my.click.uz/services/pay?service_id=<SERVICE_ID>&merchant_id=<MERCHANT_ID>&amount=1000&transaction_param=<order number>`,
   enter a phone or card, pay the invoice in Click Up. Our Prepare/Complete calls are in
   IntegrationLog (`click`, `webhook.prepare|complete`) — send those to the Click group if it fails.
5. Buttons: Click offers a redirect button (`my.click.uz/services/pay`, which itself accepts a Click
   phone **or** any Uzcard/Humo card) and an on-page card widget (`my.click.uz/pay/checkout.js`).
   The storefront uses the redirect link — it covers both payer types without third-party JS on our
   pages (mobile performance, CSP). The widget can be added later if the owner wants payment
   without leaving the site.

## NOT verified (open questions 28–36)
Resolved on 2026-11-12 from the official docs: q.28 (Payme link format, test host from the POST
form example), q.29 (detail field names, per-unit price, package code required), q.33 (Click link),
q.34 (Click fiscalization), part of q.30 (`perform_time/cancel_time = 0`, CheckPerformTransaction
codes). The list below keeps the history; still open: Payme `-32700`, the full Payme sandbox run,
Payme IPs (q.31), Click reversal `payment_id` (q.35).
1. Payme checkout link format `https://checkout.paycom.uz/<base64("m=…;ac.order_id=…;a=…;c=…;l=…")>`
   and the test host `https://test.paycom.uz` — from docs/06, not in any official repo.
2. Payme fiscal `detail` field names (`receipt_type`, `items[].title/price/count/code/package_code/
   vat_percent/discount`, `shipping{title, price}`), whether `price` is per unit, `units`, title
   length, shipping IKPU/VAT. Built in one function (`buildPaymeReceiptDetail`), switchable per
   cashbox (`fiscalDetail=off`).
3. `perform_time`/`cancel_time` = `0` when not happened (we follow Payme's protocol convention; the
   template returns `null`).
4. `-32700` for unparsable JSON (JSON-RPC 2.0 spec; the template has no constant for it).
5. Whether Payme's sandbox expects `-31050…-31099` instead of the template's `-31008` for
   "already paid / cancelled" and for "another transaction is in progress".
6. Payme sandbox scenario list (run all scenarios at test.paycom.uz before going live).
7. Payme IP allowlist: not in the repos. `allowedIps` is optional; behind Cloudflare + Caddy the
   client IP must come from `CF-Connecting-IP`/trusted proxies (Phase 6) before enabling it.
8. Click hosted payment link `https://my.click.uz/services/pay?service_id&merchant_id&amount&
   transaction_param&return_url` (official repo only shows the legacy POST form to
   `https://my.click.uz/pay/`). `merchant_prepare_id`/`merchant_confirm_id` = order-number digits
   (Click documents them as integers).
9. Click fiscalization of online payments (IKPU per item) — not in the official repos.

## Before go-live checklist
- [ ] Payme test cashbox: endpoint + `order_id` field set; all sandbox scenarios green.
- [ ] Payme live key entered, `mode=live`; one real 1 000 so'm payment + cabinet refund.
- [ ] Click test service: Prepare/Complete URLs set; test payment + failure + repeat.
- [ ] Fiscal receipts appear for both providers with the right IKPU/package codes (docs/13 q.6):
      Payme — receipt in the Payme cabinet; Click — `fiscalReceiptUrl` filled on the payment
      (admin order page shows the receipt link).
- [ ] Click: Prepare/Complete URLs in merchant.click.uz, service activated, server IP/domain
      whitelisted by Click, `merchantUserId` + shipping IKPU/package code entered.

## Incident notes
- "Paid but order not confirmed": check `IntegrationLog` (`integrationKey` payme/click,
  `kind webhook.*`) and `OrderEvent` for the order; Payme `CheckTransaction` state 2 ⇒ the money moved.
- A Payme transaction stuck in state 1 is cancelled by Payme (or by us with reason 4 after 12 h).
- Never mark an online payment PAID by hand: the webhook is the only source of truth (docs/02).
