# Runbook · Audiences (A8) and server-side ad signals

Code: `apps/api/src/audiences/` (rule compiler `compile.ts`, refresh `audience.service.ts`,
destination sync `destinations.service.ts`, signals outbox `ad-signals.service.ts`, BullMQ queue
`audiences` in `audiences.module.ts`), adapters in `apps/api/src/integrations/providers/ads/`
(`meta.ts`, `google-ads.ts`, `tiktok.ts`, `yandex-audience.ts`, fakes in `fake.ts`), admin
`apps/api/src/admin/audiences/`, UI `apps/admin/src/app/(panel)/audiences`.
Tests: `apps/api/src/audiences/compile.test.ts`, `apps/api/src/integrations/providers/ads/ads.test.ts`
(hashing vectors + request shapes), `apps/api/test/audiences.int.test.ts` (preview = hand-written
SQL, refresh diff, consent filtering, fake destinations, signal idempotency), e2e
`e2e/tests/admin-audiences.spec.ts`. Decisions: CLAUDE.md §6 "Audiences", "Audience destinations",
"Ad signals".

## Source of truth (2026-10-27)
The platforms' documentation hosts (developers.facebook.com, developers.google.com,
business-api.tiktok.com/portal, yandex.ru/dev) are unreachable from the dev environment. The
protocols were built from official SDKs/templates (read only, cloned into an isolated scratch
directory) cross-checked against a second source each:

| # | Source | Pin | Used for |
|---|---|---|---|
| M1 | `facebook/facebook-nodejs-business-sdk` — `src/objects/serverside/{utils,event-request,server-event,user-data}.js`, `src/objects/custom-audience.js`, `src/api.js`, `examples/*custom_audience*`, `__tests__/user-data-pii-utils.test.js` | `0d245ec888c1af38d68994fd7f2e24cd38abc82f` (2026-09-18), Graph `v26.0` | CAPI endpoint `/{pixel}/events`, body `{data, test_event_code}`, ServerEvent/UserData field names, phone normalisation (strip everything but digits), `/{audience}/users` POST/DELETE, `act_{id}/customaudiences` create params |
| M2 | `facebook/facebook-python-business-sdk` — `facebook_business/adobjects/helpers/customaudiencemixin.py` | `efd8423a2e595ea8d4c04eb824ce113f2f1d68cd` (2026-09-17) | audience payload `{schema: 'PHONE_SHA256', data: [sha256]}`, PHONE key = digits only |
| G1 | `googleapis/googleapis` — `google/ads/googleads/v26/services/{conversion_upload,offline_user_data_job,user_list}_service.proto`, `common/offline_user_data.proto`, `resources/user_list.proto` | `933dd1be8180a22bca2dc473b53d4f4297ee3b0c` (2026-10-26) | REST paths (`:uploadClickConversions`, `offlineUserDataJobs:create`, `:addOperations`, `:run`, `userLists:mutate`), field names, `membership_life_span` ≤ 540, hashed phone = SHA-256 of E.164 |
| G2 | `googleads/google-ads-python` — `examples/remarketing/add_customer_match_user_list.py`, `upload_enhanced_conversions_for_leads.py`, `google/ads/googleads/client.py` | `2b71584744209b1fa59572d17bd521afb1df851e` (2026-10-22), default API `v26` | Customer Match flow (job create → operations → run), consent fields, `normalize_and_hash` (remove whitespace, keep `+`), conversion record fields |
| T1 | `tiktok/tiktok-business-api-sdk` — `java_sdk/docs/AudienceApi.md`, `CustomAudience{Create,Update}Body.md`, `js_sdk/docs/{EventCallbackApi,PixelTrackBody,PixelContext,PixelContextUser}.md` | `f809c396520df2d7b201a9ccc5378d822b728ed3` (2026-02-28), API `v1.3` | `/dmp/custom_audience/{file/upload,create,update}/`, `calculate_type`, `file_signature`, `action` APPEND/REMOVE, 1 000-member minimum, user fields hashed with SHA-256 |
| T2 | `tiktok/gtm-template-eapi` (TikTok's official server GTM template) — `template.js` | `089e34eef2e02f8b12a50e9180d958fdb15e6f25` (2024-05-30) | Events API 2.0 `POST /open_api/v1.3/event/track/` body (`event_source: 'web'`, `event_source_id`, `data[{event, event_time, event_id, page, user, properties}]`), `Access-Token` header, event name map (AddToCart, InitiateCheckout, CompletePayment), hash vector `sha256('1231231234')` |
| T3 | `stape-io/tiktok-tag` — `template.js` | `81f48a113a31d8aaab6191ec5a13d02801eed52a` (2026-09-03) | cross-check: user fields hashed as given (trim + lowercase), same endpoint |
| Y1 | Yandex Audience reference pages (web search snippets): `segments/uploadCsvFile`, `segments/modifyUploadingData`, "Data requirements", help "File requirements" | fetched 2026-10-27 | `upload_csv_file`, `modify_data?modification_type=addition|subtraction|replace`, SHA-256 required for new hashed uploads since 2025 (MD5 no longer accepted), phone with country code without symbols, minimum list size |
| Y2 | `ssheremeta/yandex-audience-api` (Python) — `yaaudience/core.py` | `d917f9ef538833c2a794b0d2172f6f0a268d9f43` (2018) | host `https://api-audience.yandex.ru/v1/management`, `Authorization: OAuth`, `segment/{id}/confirm` body `{segment:{id,name,hashed,content_type}}` |
| Y3 | `nikon72ru/yandex-audience-api` (Go) — `audience/segments.go`, `client.go` | `589b5138e1b4d274beac5242cf7eafe135f1e077` (2019) | multipart field `file`, `upload_file` vs `upload_csv_file`, confirm call |

Y2/Y3 are old and hash with MD5; only their endpoint/body shapes are used.

## Hashing (what leaves our servers)
Only SHA-256 hex of the customer's phone, normalised per platform, plus SHA-256 of our customer id
as external id (Meta, TikTok) and click ids the visitor arrived with. Never names, raw phones, IPs
or user agents (we store neither IP nor UA). `adPhone()` (contracts) + `hashPhone()`:

| Platform | Normalised `+998 90 123 45 67` | SHA-256 |
|---|---|---|
| Meta, Yandex | `998901234567` | `172443bc…54f2d3` |
| Google, TikTok | `+998901234567` | `b0ff57ed…eb6f7c` |

## Audiences: operations
- Refresh: hourly job `audiences.refresh` (every segment; inactive ones only sync = remove uploads)
  and `audiences.segment.refresh` after a save or "Hozir yangilash". One run per segment at a time
  (Redis lease `forest:audiences:segment:<id>`).
- A destination uploads only when its integration is **CONNECTED** (A10). In `PROVIDERS_MODE=fake`
  connecting stores the credentials and the in-memory fake receives the hashes.
- Status per segment × destination (A8): `ok`, `error` (last error shown; next refresh retries
  the same diff), `not_connected`, `too_small` (TikTok < 1 000, Yandex < 100 consenting members —
  nothing is sent until the list grows), `off`. Details in A10 logs (`audience.sync`).
- Owner setup:
  - **Meta**: Business Manager system user token with `ads_management` on the ad account and the
    pixel; integration `meta_capi` fields `pixelId`, `accessToken`, `adAccountId` (without `act_`).
    Accept the Custom Audience terms for the ad account once in Ads Manager.
  - **Google Ads**: developer token (basic access), OAuth client id/secret + refresh token of a user
    with access to the customer, `customerId` (+ `loginCustomerId` when accessed through an MCC),
    conversion action ids for purchase (`conversionActionId`) and lead (`leadConversionActionId`),
    both of type "Import → clicks" with enhanced conversions for leads on. Customer Match requires
    the account to be eligible (policy/spend history).
  - **TikTok**: Events API access token + pixel code; `advertiserId` for audiences.
  - **Yandex Audience**: OAuth token with `audience:use` scope of the Direct account (integration
    `yandex_audience`).
- Disconnecting an integration stops uploads; what the platform holds stays until removed in its
  cabinet or the integration is reconnected and the segment's destination switched off.

## Ad signals: operations
- `ads.signals.collect` (every minute) reads lead / add_to_cart / begin_checkout / purchase events
  older than 2 min after the cursor `JobCursor('ads.signals')` (first run starts at "now": connecting
  a platform never replays history; events > 7 days old are never sent). A row per platform + event
  id is created only for customers whose latest ADS_MATCHING consent is granted.
- `ads.signals.send` (every minute) claims due rows (`FOR UPDATE SKIP LOCKED`, 5 min lease),
  re-checks consent (withdrawn → `SKIPPED`), sends, and marks `SENT` / `FAILED` (backoff 1 min, 5 min,
  15 min, 1 h, 3 h, 6 h…) / `DEAD` after 8 attempts / `SKIPPED` (no identifiers, no conversion action,
  integration disconnected). One `signals.send` IntegrationLog row per batch.
- Dedup with browser pixels: `event_id` = our Event row id (Meta, TikTok). The storefront pixel (not
  built yet) must send the same id; purchase ids are deterministic (`purchaseEventId(orderId)`).
- Re-sending a period (e.g. after fixing credentials): set rows back to `PENDING` with
  `nextAttemptAt = now()` (`UPDATE "AdSignal" SET status='PENDING', attempts=0, "nextAttemptAt"=now()
  WHERE platform=… AND status IN ('FAILED','DEAD')`). Platforms deduplicate by event id / order id.

## Unverified points (open questions in docs/13)
- Graph API version `v26.0` (SDK default) and Google Ads `v26` will be deprecated over time: bump
  `META_GRAPH_URL` / `GOOGLE_ADS_URL` deliberately.
- TikTok phone normalisation for Events API and customer files (we send E.164 with `+`), the
  `calculate_type` enum value `PHONE_SHA256`, and the lead event name (`SubmitForm`).
- Yandex Audience: `content_type: 'crm'` with a single `phone` column and `hashed: true` for SHA-256
  values, and whether `modify_data` accepts hashed CRM files.
- Google: whether `uploadClickConversions` with only a hashed phone (no gclid) is accepted for our
  conversion actions (enhanced conversions for leads must be enabled), and Customer Match eligibility.
