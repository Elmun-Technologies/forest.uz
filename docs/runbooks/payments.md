# Runbook · Payments (Payme, Click)

Code: `apps/api/src/payments/*` (webhooks), `apps/api/src/integrations/providers/{payme,click}.ts`
(pure protocol helpers + checkout link adapters), state changes in
`apps/api/src/commerce/order-lifecycle.service.ts`. Tests: `apps/api/test/payments.int.test.ts`,
`apps/api/src/integrations/providers/{payme,click}.test.ts`.

## Source of truth (2026-10-26)
The official doc sites (`*.paycom.uz`, `docs.click.uz`) are blocked from the dev environment, so the
protocol was implemented from the providers' **official GitHub repositories**, pinned to these commits:

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
`merchantId`, `merchantUserId`, `secretKey`, `mode`.

## What is implemented (verified against the sources above)
**Payme** — every method of the template: `CheckPerformTransaction`, `CreateTransaction`,
`PerformTransaction`, `CancelTransaction`, `CheckTransaction`, `GetStatement`, `ChangePassword`.
- Auth `Authorization: Basic base64("Paycom:<key>")`, constant-time compare → else `-32504`.
- Errors: `-32504` privilege, `-32600` invalid request (missing `id`/`time`/`reason`), `-32601`
  method not found (`data` = method), `-32400` internal, `-31001` amount, `-31003` transaction not
  found, `-31007` cannot cancel, `-31008` cannot perform, `-31050` account (`data: "order_id"`) —
  messages `{ru, uz, en}` (English text from the template, translations ours).
- Validation order = template `Order::validate`: amount numeric (`-31001`) → account (`-31050`) →
  amount equal to order total in tiyin (`-31001`) → order waiting for payment, else `-31008`
  (already paid / cancelled / reservation expired).
- `CheckPerformTransaction` with another created/performed transaction → `-31008`;
  `CreateTransaction` with another active transaction id → `-31050` (both as in the template).
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

## NOT verified (open questions 28–36)
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
- [ ] Fiscal receipts appear for both providers with the right IKPU/package codes (docs/13 q.6).

## Incident notes
- "Paid but order not confirmed": check `IntegrationLog` (`integrationKey` payme/click,
  `kind webhook.*`) and `OrderEvent` for the order; Payme `CheckTransaction` state 2 ⇒ the money moved.
- A Payme transaction stuck in state 1 is cancelled by Payme (or by us with reason 4 after 12 h).
- Never mark an online payment PAID by hand: the webhook is the only source of truth (docs/02).
