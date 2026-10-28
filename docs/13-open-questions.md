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

## Found during Phase 3 — MoySklad (details & sources: `docs/runbooks/moysklad.md`)
Built from official doc search snippets + four open-source clients (Node ×2, Go, a PHP SDK generated from the remap 1.2 OpenAPI spec); `dev.moysklad.ru`/`api.moysklad.ru` are unreachable from dev. Answers replace q.12.
60. **MoySklad account** (replaces q.12): an administrator user's API token (the short stock report is admin-only), account currency **UZS**, retail price type name (default `Chakana`), store id to sell from, legal entity id (if several), product attribute holding the IKPU (default `ikpu`) and the customer-order string attribute for the delivery method (default `dostavka`).
61. **SKU alignment**: does every site SKU equal the MoySklad `article` (simple products, kits) or the modification `code` (variants)? Unmatched MoySklad items arrive as DRAFT products; unmatched site variants stay unlinked (local price/stock).
62. **Customer-order states**: the state names to map our statuses to (defaults: Подтвержден, Собран, Отгружен, Доставлен, Отменен, Возврат). Does moving an order to a cancelled state release its reserve by itself? We set every position's reserve to 0 explicitly on CANCELLED/RETURNED.
63. **Webhooks**: no source documents a signature, source IPs, retry schedule or timeout; we use a secret path token and only re-read entities. Confirm the webhook-stock notification body (`accountId`, `stockType`, `reportType`, `reportUrl`?) — any body triggers a stock refresh.
64. **Variant prices**: when a modification has no own `salePrices` value we use its product's price (as the MoySklad UI shows). Confirm, and whether variants may carry their own IKPU (variants have no custom attributes in the API — we use the product's).
65. **Kits**: MoySklad stock reports list products/variants only; kit stock is computed by us as the components' minimum (q.27). Are kits sold only as MoySklad `bundle` (Комплект), and does a customer order with a bundle reserve its components?
66. **Archived items**: does `entity/product` list archived products by default? Either way archived or missing → variant inactive.
67. **Counterparty matching**: phone filter is exact; we write and search E.164 (`+998901234567`). Existing counterparties typed differently (`90 123 45 67`) will be duplicated — normalise them in MoySklad, or accept duplicates?
68. **Customer data in MoySklad** (Russian SaaS): pushing name + phone (counterparty) is required by the docs/06 mapping; addresses are not sent. Does this fit the UZ personal-data localisation law (docs/14), or must counterparties be anonymised (one retail counterparty — `customers` flow off + default counterparty)?
69. **Shipping and payments in MoySklad**: delivery cost is only in the order comment (no service position) and payments/shipments (`paymentin`, `demand`) are not created by us — should the warehouse create the demand from the order (which ends the reserve), or should we post them?

## Found during Phase 4 — SEO center A9 (details & sources: `docs/runbooks/seo.md`)
Built from Google's generated Node SDK builds, Google auth libraries, four Yandex Webmaster and four IndexNow open-source clients; the official doc hosts are unreachable from dev.
70. **Search Console access**: a Google Cloud project with the Search Console API enabled, a service-account JSON key, and that service account added as a user of the `forest.uz` property (URL-prefix `https://forest.uz/` or domain `sc-domain:forest.uz` — which one will be verified?). GSC days are PST; A9 shows them as calendar days without a Tashkent shift — acceptable?
71. **Yandex Webmaster access**: an OAuth app + token for the account that owns the site (token lifetime ~1 year, then reconnect), and the host id (`https:forest.uz:443`). Unverified: whether one-day windows of `search-queries/popular` return complete per-day values, the real `limit` maximum (500 per open-source clients), and whether `AVG_SHOW_POSITION` is impression-weighted (A9 averages it weighted by impressions).
72. **LocalBusiness schema**: Google needs a street address (and ideally opening hours / geo) for LocalBusiness. `store.info` has no public shop address (pickup point/showroom?) — until one exists we render Organization only. Is there a public address to show?
73. **IndexNow**: on by default, pinging Yandex and Bing for published/updated/archived product pages and SEO edits. Keep both engines (they share submissions per the protocol), and should removed (archived) URLs be submitted? Note: Google does not support IndexNow.
74. **Legal page titles**: the legal pages' titles (`Ommaviy oferta | Forest`, `Maxfiylik siyosati | Forest`…) are shorter than the 30-character minimum A9 checks (docs/10 gives only the 60 maximum), so they show as length warnings. Write longer SEO titles for them in A9, or should the minimum not apply to legal pages?

## Found during Phase 4 — Audiences A8 and ad signals (details & sources: `docs/runbooks/ads.md`)

75. **Ad platform accounts**: Meta system-user token (`ads_management`) + pixel + ad account id; Google Ads developer token, OAuth client + refresh token, customer id (MCC id if any) and two "Import → clicks" conversion actions (purchase, lead) with enhanced conversions for leads; TikTok Events API token, pixel code and advertiser id; Yandex Audience OAuth token. Who owns each account?
76. **Consent wording**: hashed phones go to Meta/Google/TikTok/Yandex only for customers whose latest `ADS_MATCHING` consent is granted (checkout/cabinet). Is the current consent text enough for audience matching *and* server-side conversion events (CAPI etc.) under UZ law and the platforms' terms (Meta Custom Audience terms, Google Customer Match policy)?
77. **Anonymous visitors**: server-side signals are sent only for identified customers with ads consent; marketing-cookie consent of anonymous visitors is not stored server-side, so their events reach platforms only through browser pixels (not built yet). Should the ingest record the cookie's `marketing` flag per session so anonymous add_to_cart/begin_checkout can be forwarded with click ids?
78. **TikTok details** (unverified): phone normalisation before SHA-256 (we send E.164 with `+`), customer-file `calculate_type` = `PHONE_SHA256`, the event name for leads (`SubmitForm`), and REMOVE failing when the audience would drop below 1 000.
79. **Yandex Audience details** (unverified): CRM CSV with one `phone` column of SHA-256 values confirmed as `content_type: 'crm'`, `hashed: true`; does `modify_data` accept hashed files; minimum size (100 vs 1 000 per sources).
80. **Google enhanced conversions without gclid**: we upload purchase/lead conversions with the hashed phone (and gclid when the visitor came from an ad). Confirm the conversion actions accept phone-only uploads and that `consent.adUserData = GRANTED` matches our consent.
81. **Audience ROAS**: A8 shows 30-day CR and revenue of members; ROAS needs ad spend per audience, but spend is imported per campaign. Map audiences to campaigns (naming convention), or drop ROAS from A8?
82. **Preset rules**: sofa-kit viewers use the page path `/p/divan-yangilash-toplami` (a slug change needs a rule edit); "Mato xaridorlari" upsell is "bought fabric spray ≥ 21 days ago and never bought the cleaner" (docs/07) while the design says "mum va mebel upsell" — which products should the upsell exclude? The abandoned-cart preset omits the design's "Reklamaga rozilik bor" rule (ad destinations filter consent themselves; Telegram/SMS reach would shrink) — OK?
83. **Automatic messages from segments** (template + delay + channel) are stored but run in Phase 5: caps, quiet hours and which templates are approved for Eskiz marketing.
103. **Meta CAPI `action_source`** (unverified): server-forwarded events go as `other`, because `website` events require `client_user_agent` (Meta docs, not reachable here) and we store neither UA nor IP. Does Meta still deduplicate them against the browser pixel's `website` events with the same `event_id`, and do they count for website campaign optimisation? Alternative: store the raw UA on `Session` (personal data) and send `website`.
84. **Session replay consent and sampling** (A3): recording runs only for visitors who switched on the separate "Sessiya yozuvi" consent ("Hammasiga roziman" grants it; "Sozlash" starts with it off), sampled 30 % of sessions + 100 % of sessions that reach checkout (docs/07 `[confirm]`; editable on A3 by the Owner, with a kill switch). Confirm the rates, the consent wording (uz/ru in `apps/web/messages`) and that the privacy policy mentions recordings (30-day retention, inputs masked). Visitors who decided before the toggle existed are not recorded until they decide again (the banner is not re-shown).

## Found during Phase 4 — Tracker & ingest (details: `packages/tracker/README.md`)

85. **Analytics consent wording**: the cookie banner says analytics cookies run "only with your consent", while docs/07 says essential first-party analytics is on by default. The tracker runs unless the visitor explicitly declines analytics (then it stops at once and deletes `fr_sid`); `fr_aid` is issued on the first page as a necessary cookie (cart, one-code-per-device rule). Confirm with the lawyer, or change the banner text / switch the tracker to opt-in (most sessions would then be unmeasured).
86. **GeoIP database**: which file do we ship — DB-IP Lite City (CC BY 4.0, attribution required in the admin footer) or MaxMind GeoLite2 City (account + licence key, EULA)? Who refreshes it monthly (`GEOIP_DB_PATH`, read on API start)? Without a file, regions show as unknown in A2/A3.
87. **Raw IP / fraud**: docs/07 allows a /24-truncated IP for 7 days for fraud checks; nothing stores it now (no consumer yet). Keep it that way until a fraud rule needs it?

## Found during Phase 5 — messaging automations (CLAUDE.md §6 "Messaging engine")
88. **Eskiz approval of the new texts**: `cart_abandoned_24h_sms`, `review_request_sms`, `waitlist_back`, `order_cancelled`, `order_phone_created` (and any custom audience template sent by SMS) start unapproved and are never sent by SMS until the owner gets them approved in the Eskiz cabinet and ticks «Eskiz tasdiqlagan» in A12. Every **marketing** SMS text carries its opt-out as the `{stop}` slot inside the template (`… Rad etish: {stop}` → `<APP_URL>/uz/obuna/<token>`, ~45 chars), so the approved wording includes it; the seeded `cart_abandoned_24h_sms` / `review_request_sms` got the slot (migration `20261027161001`) and are unapproved until re-approved — submit them to Eskiz *with* the slot (does Eskiz accept a variable link there?). "O'zimga test" sends exactly the rendered text. The pre-Phase-5 service texts were marked approved by the migration: confirm each one matches the approved wording.
89. **Marketing over the daily cap**: a marketing message that would exceed `marketingPerDay` is skipped for good (SKIPPED_CAP), not moved to the next day — right for the cart reminder (SAVAT5 "today"); should review requests / audience messages wait for the next day instead?
90. **Telegram marketing consent**: Telegram reminders (abandoned cart, review request, audience messages) need a granted TELEGRAM consent row. The bot must record it when the customer starts the bot (`/start`, source `bot`) — confirm that starting the bot counts as opt-in for reminders (docs/02 lists `telegram` as a consent channel).
91. **Review request by SMS**: links the order tracking page (`/t/<token>`) — the storefront has no review form yet. Build a review page (verified purchase, photo + consent) or keep reviews Telegram-only?
92. **Order cancellation SMS / phone-order confirmation**: draft templates `order_cancelled` and `order_phone_created` exist (inactive). Wire them (staff cancel / auto-cancel of unpaid orders; `source = 'phone'`) once the texts are approved?

## Found during Phase 5 — webhooks, API keys, CMS, AI drafts (details: `docs/runbooks/webhooks-and-api.md`)
93. **Claude API and data location**: product/SEO drafts send only catalog facts and page titles to Anthropic (servers outside Uzbekistan). Operator reply drafts would send the customer's latest chat message (phones, emails, links, `F-`/`C-` ids masked, but free text such as a name or street can survive), so they are **off by default** and only the Owner can switch them on (Integratsiyalar → "AI qoralamalar"). Confirm with the lawyer before switching it on. Also: which model and monthly budget (default `claude-opus-5-5`, effort `low`, 300 drafts/day cap)?
94. **Webhook payloads without PII**: outbound webhooks carry order numbers, statuses, totals, region/district and SKUs but no names, phones or address lines (docs/05 is silent). If a partner tool (Google Sheets, n8n → CRM) must receive contacts, decide which system, under which legal basis, and add an explicit opt-in field per endpoint.
95. **Partner API scope**: docs/05 lists no partner endpoints, so the API key API is read-only (`products:read`, `stock:read`). Do n8n/Make flows need orders (`orders:read`) or writes (e.g. stock from another system)? Each new scope needs its own PII review.
96. **Brend page copy**: the page uses the design's final copy (UZ + our RU translation, owner review needed) and shows the "Bizning yo'l" story only after the owner writes and publishes it in admin (Ilhom va Brend → Brend sahifasi). The design's certificate / factory logo tiles are hidden until real files exist. "Inson birinchi: Hidsiz, xavfsiz formulalar" is a product-safety claim — confirm it is backed by the manufacturer's documents.
97. **`cart.abandoned` and `stock.low` webhooks** (docs/06 list) are not emitted yet: there is no committed row that marks a cart as abandoned (5B's job) or a stock threshold crossing. Wire them when those events exist.

## Found during Phase 5 — Telegram bot (details & sources: `docs/runbooks/messaging-and-fiscal.md` "Telegram bot")
98. **Bot links need a public https site**: Telegram refuses inline URL buttons to `localhost`/plain http, so `APP_URL` must be the public https domain before the bot is connected live (dev/staging use the fake transport). Confirm the production domain and that `API_URL/v1/webhooks/telegram/*` is reachable from Telegram (setWebhook runs on connect).
99. **Admin alerts group**: the bot must be added to the staff group and its chat id (negative, `-100…`) entered in the `telegram` integration (`adminChatId`). Which events should alert at night (new orders and SLA risk alert 24/7 now), and who reads the group?
100. **One review per order**: a bot review request rates the order's main product (largest line); other products of the order get no rating. Enough, or ask per product?
101. **`/start` = reminder opt-in (q.90)**: implemented — the first `/start` of a chat linked to a customer, and sharing the phone, record a granted TELEGRAM consent (source `bot`); a customer who opted out elsewhere is not re-subscribed by `/start` alone, but `/start` after the bot's own `/stop` re-subscribes (explicit action). Confirm with the lawyer.
102. **`copy_text` button** ("Kodni nusxalash") is Bot API 7.11+ (grammY types 5.0.0, python-telegram-bot 22.0); very old Telegram clients may not show it — the code is also in the text as `<code>`, tap-to-copy.
