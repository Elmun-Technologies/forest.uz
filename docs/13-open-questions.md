# 13 · Open questions (owner must answer — do not invent)

Build with configurable defaults and clearly marked placeholders; list any new questions here.

## Business / legal
1. Legal entity name, STIR (TIN), address, bank details — for offer, receipts, footer.
2. Lawyer review of offer, privacy, returns texts (drafts in `design/source/Huquqiy.dc.html`). Exact return terms (14 days unopened?).
3. Fiscal solution for **cash on delivery** (OFD / online cash register provider) — accountant decision. Without it COD can't launch legally.
4. Hosting in Uzbekistan for personal data (which provider/DC) — confirm with lawyer.

## Product & pricing
5. Manufacturer name, country, certificates; product specs (coverage, drying time, shelf life) — currently `[brackets]`.
6. Final prices, volumes, colors; IKPU (MXIK) + package codes per SKU.
7. Real packshots (white background) and 5–10 real before/after photo pairs (same angle); 15-s vertical process video; video guides.
8. Kit compositions and kit prices.

## Delivery & payments
9. Delivery prices per zone; free-delivery threshold (500 000 everywhere, or 700 000 for regions?); Sunday rules; COD max amount.
10. Payme & Click merchant contracts (merchant id/keys — test first); Click service id.
11. Yandex Delivery contract/API token; BTS partner API docs and contract.
12. MoySklad account: price type name, warehouse, custom attribute names (IKPU, delivery method).

## Marketing
13. Canonical first-order code — use `SALOM10` (design also shows `FOREST10`)?
14. Max marketing messages per day: 1 (A12) or 2 (bot map)? Default 1.
15. Replay sampling rate & consent banner wording.
16. Ad accounts: Meta pixel/CAPI token, Google Ads (developer token, conversion actions), TikTok, Yandex Direct.
17. Real reviews: none yet → hide rating blocks until first verified reviews (no fake numbers).

## Domains & accounts
18. Domain (`forest.uz`?) and DNS access; Cloudflare account.
19. Telegram bot username/token, admin group; Eskiz account + approved SMS templates. The final texts of every SMS template (`MessageTemplate` rows: `otp`, `order_created`, `order_paid`, `order_confirmed`, `order_courier`, `payment_reminder`, `lead_promo_sms`, … — seeded in `packages/db/src/seed/data/content.ts`, UZ+RU) must be submitted to Eskiz for approval before launch; `{raqam}`, `{link}`, `{vaqt}`, `{kod}` are the dynamic slots. Change a text only together with a new Eskiz approval.
20. Brandbook PDF → add to `design/brandbook/`.

## Found during Phase 0 (design ↔ docs contradictions; defaults chosen, please confirm)
21. Tashkent delivery price: design shows **30 000** (mobile checkout) and **[35 000]** (legal page). Seeded 30 000. BTS 45 000.
22. Tashkent cut-off: docs say **18:00**, legal draft says **[19:00]**. Seeded 18:00 (after → next day 12:00). Is same-day delivery promised until 23:59 for orders confirmed just before cut-off?
23. Return window: home says **14 days**, legal draft says **[10] days**. Seeded 14.
24. Store hours: footer "Har kuni 9:00–20:00" vs bot operator hours "Du–Sha 9:00–21:00". Both kept as separate settings — confirm both.
25. Store phone `+998 99 820 22 77` and `info@forest.uz` appear in the design without brackets — are they real?
26. Selector "buy new" comparison prices (`[yangi divan narxi]` etc.) — please provide typical new-item prices, otherwise the comparison row stays hidden.
27. Kits: are kits pre-packed boxes with their own stock in MoySklad (current assumption), or should availability be computed from component stock?

## Found during Phase 2 — payments (details & sources: `docs/runbooks/payments.md`)
Implemented from the providers' official GitHub templates; these points could not be verified there.
28. **Payme checkout link** format (`checkout.paycom.uz/<base64 m=…;ac.order_id=…;a=…;c=…;l=…>`) and test host `test.paycom.uz` — please confirm with Payme (or from their docs).
29. **Payme fiscal receipt `detail`** exact field names (`receipt_type`, items `title/price/count/code/package_code/vat_percent/discount`, `shipping`), per-unit vs line price, and the IKPU/VAT to use for the delivery line. Until confirmed it can be switched off per cashbox (`fiscalDetail=off`) — but then Payme issues no fiscal receipt.
30. **Payme sandbox expectations**: `perform_time/cancel_time = 0` (template returns null), `-32700` for bad JSON, and whether "already paid / another transaction in progress" must be `-31008` (template) or `-31050…-31099`. Run the full sandbox scenario list on the test cashbox.
31. **Payme IP addresses** for the optional allowlist (not published in the repos); enabling it also requires trusting Cloudflare's `CF-Connecting-IP` (Phase 6).
32. **Payme cashbox settings**: account field named `order_id` (string, value `F-10482`), endpoint `https://<API_DOMAIN>/v1/webhooks/payme`; merchant id, live key and test key.
33. **Click payment link** `my.click.uz/services/pay?service_id&merchant_id&amount&transaction_param&return_url` (official repo shows only the legacy POST form) and whether integer `merchant_prepare_id` = order-number digits is acceptable.
34. **Click fiscalization** of online payments (how IKPU per item reaches Click's fiscal receipt) — ask the Click manager.
35. **Click refunds**: is the Merchant API reversal's `payment_id` the `click_trans_id` from Prepare/Complete? Until confirmed, Click refunds are done in the Click cabinet and recorded manually.
36. **Click credentials**: service_id, merchant_id, merchant_user_id, secret key (test service first); Prepare/Complete URLs `https://<API_DOMAIN>/v1/webhooks/click/prepare|complete`.

## Found during Phase 2 — Yandex Delivery (details & sources: `docs/runbooks/delivery.md`)
Built from the official doc pages' search snippets + three independent open-source clients; the doc site itself is unreachable from dev and there is **no sandbox** (an accepted claim dispatches a real, paid courier).
37. **Yandex Delivery contract for Tashkent**: corporate account with Express Claims API access on `b2b.taxi.yandex.net` (or Yango), billing in **UZS**, which tariff (`express` car courier — our default — or `courier`), OAuth token (cabinet → Integration → "Get token"). Warehouse address, exact lat/lng and the warehouse contact name/phone for the integration form.
38. **Item point field**: claims/create items use `droppof_point` in two clients and the claim-info example but `dropoff_point` in the check-price docs. We send neither (documented as mandatory only with several destinations) — confirm on the first real claim.
39. **Coordinates**: are destination coordinates mandatory in claims/create? We send them only when the customer dropped a map pin (no geocoding); otherwise the address text only. Order `[longitude, latitude]` confirmed by one client + Yandex convention.
40. **Status callback**: exact query parameters Yandex appends to `callback_url` (`claim_id`, `updated_ts`?), method, retry schedule and source IPs. It is unsigned; ours carries a secret `key`. Keep `callbacks=off` (polling only) until confirmed on a real claim.
41. **COD with Yandex couriers**: can Yandex couriers in Tashkent collect cash/card for us (`payment_on_delivery` / `buyout` look Russia-only)? Until answered, COD orders get a Yandex claim only with `allowCod=on`, and the amount is written in the courier comment.
42. **Recipient notifications / codes**: does Yandex SMS the recipient (`skip_client_notify`) and require pickup/delivery confirmation codes (`skip_confirmation`) in Uzbekistan? Defaults are left as Yandex sets them.
43. **Rate limits** for `claims/info`, `points-eta`, `driver-voiceforwarding`, `check-price` (not published in any source). We poll at most 50 claims per minute, sequentially, with backoff.
44. **Cancellation and offer expiry** in Uzbekistan: when free cancellation ends, the paid-cancellation fee, and what status an un-accepted claim gets after its ~10 min offer expires (we re-check every 5 min while it awaits acceptance).
45. **Status semantics** to confirm: `performer_draft`, `pay_waiting`, `delivered` vs `delivered_finish`, `returned` vs `returned_finish`, `cancelled_with_items_on_hands` (mapping table in the runbook).
46. **Declared value**: items carry `cost_value` (unit price, UZS) — does it drive insurance/liability, and is it required for UZ?
47. **Live quote**: switch it on for the Tashkent zone (`liveQuote`), or keep the flat zone price (30 000)? Free delivery from the threshold applies either way. New SMS texts `order_shipped` (and `order_courier`, `order_delivered`, `order_delivery_failed`) need Eskiz approval (q.19).

## Found during Phase 2 — messaging, Telegram login, fiscal, BTS (details & sources: `docs/runbooks/messaging-and-fiscal.md`)
Built from the Eskiz Postman collection export and open-source SDKs (Eskiz) and two widely used libraries (Telegram); the providers' doc hosts are unreachable from dev.
48. **Eskiz account**: login email, API secret key (my.eskiz.uz → settings) and the approved sender nickname (`from`; `4546` is Eskiz's default test nick). While the account is in test status Eskiz only sends its three fixed test texts ("Bu Eskiz dan test" …, Postman collection), so real SMS work only after activation.
49. **Eskiz templates**: every `MessageTemplate` must be approved (see q.19). New in this phase: `order_shipped_bts` (`{raqam}`, `{trek}`, `{link}`), `order_at_branch` (`{raqam}`, `{filial}`, `{link}`), `order_delivery_failed` (`{raqam}`, `{link}`) — `{trek}` (BTS waybill) and `{filial}` (branch) are new dynamic slots. Are Russian (Cyrillic, UCS-2, more parts per SMS) texts allowed and priced as expected?
50. **Eskiz token lifetime**: not documented in any source. We read the JWT `exp` when present, else assume 24 h, and renew 1 h early or on HTTP 401. Confirm the real lifetime (and whether `PATCH /auth/refresh` is preferred to re-login).
51. **Eskiz delivery callbacks**: no source documents a signature or source IPs, the content type (we accept JSON and form), which statuses are posted (final only, or also `STORED`/`ACCEPTED`), or the retry policy. We protect the endpoint with a secret path token; if Eskiz publishes IPs or a signature, add it.
52. **Eskiz send-response id**: we store the `id` of `/message/sms/send` (UUID, = `request_id` in callbacks, per the Postman collection) as `Message.providerId`. Confirm for the production account.
53. **Telegram login flow**: the widget we implemented is now documented as "login-legacy" (core.telegram.org/widgets/login-legacy); Telegram also offers "Log In With Telegram" with OpenID Connect (core.telegram.org/bots/telegram-login). Keep the widget for launch, or switch to OIDC? Either way: set the shop domain for the bot with BotFather `/setdomain`, and enter `botToken` + `botUsername` in admin → Integrations → Telegram.
54. **Telegram-only customers**: the widget never sends a phone, so such customers have none until they log in by phone and link Telegram (`/me/telegram/link`); their orders belong to the phone typed at checkout. A Telegram account already linked to another *phone* customer answers `TELEGRAM_ALREADY_LINKED` — who resolves these (operator procedure)?
55. **Payme fiscal receipts**: does Payme issue the receipt from the `detail` we send, and can we get the receipt link/fiscal sign back (to fill `Payment.fiscalReceiptUrl`)? Until then a Payme payment created with `detail` counts as fiscalized for closing the order (CLAUDE.md §6). Related: q.29.
56. **Click fiscal receipts**: until q.34 is answered, every Click order needs a manually recorded receipt (or a receipt URL on the payment) before it can be COMPLETED — acceptable?
57. **COD receipts (manual provider)**: which identifier must the operator record — fiscal sign, receipt number, OFD link (`https://…`)? The manual entry accepts a number (≤ 64 chars) and/or an https link. And are refund receipts (returned COD orders) required — `FiscalReceipt.kind = REFUND` exists but nothing records it yet.
58. **BTS manual mode**: waybill/track number format (we accept 4–40 letters, digits, dashes), branch naming, whether BTS itself SMSes the recipient (then our `order_shipped_bts`/`order_at_branch` may duplicate), and how COD cash collected by BTS is settled (when COD_PENDING → PAID). Related: q.11 (API docs).
59. **Order closing**: who moves DELIVERED → COMPLETED and when (operator after the fiscal receipt and COD settlement, or automatically N days after delivery)? Only the manual service method exists (`OrderLifecycleService.completeOrder`).
