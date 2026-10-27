# Runbook · MoySklad (A13 inventory sync)

Code: adapter `apps/api/src/integrations/providers/moysklad.ts` (+ fake `moysklad-fake.ts`), sync
`apps/api/src/moysklad/*` (`catalog-plan.ts` / `order-plan.ts` = pure rules, `catalog-sync.service.ts`,
`order-sync.service.ts`, `moysklad-jobs.service.ts`, webhook controller, `source-of-truth.ts`), admin API
`apps/api/src/admin/moysklad/*`, admin page `apps/admin/src/app/(panel)/moysklad`. Settings schema and DTOs:
`packages/contracts/src/{admin-moysklad.ts,schemas/admin-moysklad.ts}`. Tests: unit
`providers/moysklad.test.ts`, `moysklad/{catalog-plan,order-plan}.test.ts`, contracts
`admin-moysklad.test.ts`; integration `apps/api/test/moysklad.int.test.ts` against the stub
`apps/api/test/moysklad-stub.ts`; e2e `e2e/tests/admin-moysklad.spec.ts`. Decisions: CLAUDE.md §6
(2026-10-27, "MoySklad …").

## Source of truth (2026-10-27)
`dev.moysklad.ru` and `api.moysklad.ru` are blocked from the dev environment (curl and WebFetch). The
protocol was built from search snippets of the official docs plus these open-source clients, read-only
copies in the session scratchpad, cross-checked:

| Source | Version / commit | Used for |
|---|---|---|
| npm `moysklad` (wmakeev) — https://github.com/wmakeev/moysklad | 0.21.1 (`registry.npmjs.org/moysklad/-/moysklad-0.21.1.tgz`) | Base URL `https://api.moysklad.ru/api/remap/1.2`, `Authorization: Bearer`, `Accept-Encoding: gzip` on every request, `redirect: manual`, error envelope `{errors:[{error, code, moreInfo, line, column}]}`, `X-Lognex-WebHook-Disable(ByPrefix)` headers, retry only 5xx/network (`shouldRetryError.js`), `expand` needs `limit ≤ 100` (README) |
| npm `moysklad-fetch-planner` (wmakeev) | 3.2.0 | Rate-limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-Lognex-Retry-TimeInterval` (ms), on 429 `X-Lognex-Retry-After` (**ms**), `X-Lognex-Auth: 429005` = parallel-request limit (no Retry-After then); a 429 request is re-queued for every method |
| npm `moysklad-ts` (MonsterDeveloper) — https://github.com/MonsterDeveloper/moysklad-ts | 0.1.44 | `report/stock/all/current` + `bystore/current` (short stock report: one response, no paging, `stockType` = stock/freeStock/quantity/reserve/inTransit, `include=zeroLines`, `changedSince` ≤ 24 h), extended report fields (`stock`, `reserve`, `quantity`, `inTransit`) |
| Go `go-moysklad` (arcsub) — https://github.com/arcsub/go-moysklad | `97e883bed5bebbe285b53f1b3bab755ed5171136` (2025-02-20) | Limits as constants (45 requests / 3 s per account, 5 parallel per user, 1000 items per array/page), entity structs: `Variant` (`code`, `product`, `characteristics`, `salePrices`, no attributes/article), `SalePrice {value, currency, priceType}`, `Attribute {name, type, value}`, `CustomerOrder` / `CustomerOrderPosition` (`price` in kopecks, `discount` %, `reserve`, `assortment`), `Webhook {url, action, entityType, method}`, `WebhookStock {url, enabled, stockType, reportType all\|bystore}`, notification `{auditContext, events:[{meta, action, accountId, updatedFields}]}`, `StockCurrentByStore {assortmentId, storeId, stock, freeStock, …}` |
| PHP SDK generated from the remap 1.2 OpenAPI spec by a Lognex (MoySklad) employee — https://github.com/AIvchenkoLognex/php-remap-1.2-sdk | `52d03c8e14452989d34c8404b6f0aa17b87e9d53` (2026-04-28) | README limits (45 req/3 s per account, 5 parallel per user, 20 per account, 20 MB per request, 1000 items per array, **gzip mandatory**), models `Product` (`article`, `code`, `externalCode`, `archived`, `variantsCount`, `salePrices`, `attributes`, `vat`, `weight`), `State {id, name, stateType, entityType}`, `Error {errors[]: error, parameter, code, error_message, more_info}`, `Meta {href, type, mediaType}` |
| Official doc snippets (WebSearch) | dev.moysklad.ru/doc/api/remap/1.2/{reports,dictionaries,documents} | short stock report only for administrators; rows without a store hold reserves not bound to a store; `changedSince` semantics; webhook-stock `reportType` [all, bystore] / `stockType` [stock]; counterparty phone match is exact only (RetailCRM docs) |

## What the code relies on
| Area | Request | Fields |
|---|---|---|
| Health | `GET entity/organization?limit=1`, `GET context/companysettings/pricetype` | 401/403 = bad token; price type name present |
| Catalog | `GET entity/product`, `entity/variant`, `entity/bundle?expand=components` (limit 1000 / 100), follow `meta.nextHref` | `id`, `meta.type`, `name`, `article` (product/bundle SKU), `code` (variant SKU), `archived`, `variantsCount`, `product.meta.href` (variant parent), `characteristics[].value` (variant label), `salePrices[].priceType.name/value`, `attributes[].name/value` (IKPU), `components.rows[].quantity/assortment.meta.href` |
| Targeted refresh | `GET entity/{product\|variant\|bundle}/{id}`, `GET entity/variant?filter=productid={id}` | 404 = deleted |
| Stock | `GET report/stock/bystore/current?stockType=freeStock&include=zeroLines` (store set) or `report/stock/all/current?…` | `assortmentId`, `storeId`, `freeStock` (= stock − reserve) |
| Orders | `GET entity/customerorder?filter=name=F-…` (idempotency), `GET/POST entity/counterparty` (`filter=phone=+998…`, `{name, phone, companyType:"individual"}`), `GET entity/customerorder/metadata` (`states[]`), `GET …/metadata/attributes`, `POST entity/customerorder {name, organization, agent, store, state, description, attributes, positions[{quantity, price, discount, reserve, assortment}]}`, `PUT entity/customerorder/{id} {state}`, `GET …/{id}/positions` + `PUT …/positions/{pid} {reserve:0}` | references are `{meta:{href,type,mediaType}}`; state href `entity/customerorder/metadata/states/{id}` |
| Webhooks | `GET/POST entity/webhook {url, action CREATE\|UPDATE\|DELETE, entityType product\|variant\|bundle, method POST}`, `GET/POST entity/webhookstock {url, enabled, stockType "stock", reportType}` | url ≤ 255 chars |

Mapping (A13 table): name → only for new DRAFT products (content is ours afterwards); SKU ↔ `article` /
variant `code`; IKPU ↔ attribute (default `ikpu`, 17 digits, never cleared); price ↔
`salePrices[<price type>]` (default `Chakana`; minor units = tiyin in a UZS account; a variant without its
own price uses its product's); stock ↔ `freeStock` at the store (kits: min over components of
⌊free / qty⌋); order number ↔ `customerorder.name`; phone ↔ `counterparty.phone` (E.164); delivery ↔
customer-order attribute (default `dostavka`, value `<carrier> · <zone>`). The order description carries
number, payment method, zone/carrier, shipping, discount/promo and total — no name, phone or address.

## Jobs, webhooks, admin
- Queue `moysklad`: `moysklad.reconcile` hourly, `moysklad.stock.poll` every `stockPollMinutes`,
  `moysklad.orders.sync` every minute, `moysklad.item.refresh` / `moysklad.stock.refresh` (webhook,
  debounced by job id), `moysklad.sync.now` (admin). All under the Redis lease `forest:moysklad:lock`.
- Webhook URL: `https://<API_DOMAIN>/v1/webhooks/moysklad/<webhookToken>` (secret generated on connect,
  shown in full only to the Owner via the A13 "To'liq URL" button, audited). "Webhooklarni MoySklad'da
  yaratish" registers 9 entity hooks + 1 stock hook (needs a public https API URL).
- Admin API: `GET /v1/admin/moysklad/status`, `GET …/log?cursor&limit&kind&ok`, `POST …/sync {scope}`
  (`moysklad.sync`); `PATCH …/settings`, `POST …/webhooks/register` (`moysklad.edit`);
  `POST …/webhook-url` (`moysklad.edit` + `integrations.keys`). Every mutation is audited.

## Go-live checklist (what the Owner provides)
1. A MoySklad user **with administrator rights** (the short stock report is admin-only) → Settings →
   Users → Access tokens → API token; paste in admin → Integrations → MoySklad.
2. Account currency **UZS** (prices are read as minor units = tiyin) and the retail price type name
   (default `Chakana`).
3. Store (warehouse) id to sell from; legal entity id if the account has several.
4. Product custom attribute holding the IKPU (`ikpu` by default) and, optionally, the customer-order
   attribute for the delivery method (`dostavka`, type string).
5. Customer-order state names to map our statuses to (defaults are MoySklad's Russian stock states).
6. SKUs: every site variant's SKU equals the MoySklad `article` (product/bundle) or variant `code`, so
   the first pull links instead of creating drafts. Run "Hozir sinxronlash" once and check the log.
7. Webhooks: switch the flow on, then "Webhooklarni MoySklad'da yaratish" (public https API URL).

## Unverified points (open questions 60–69 in docs/13)
Webhook signature/IPs and retry policy; webhook-stock notification body; `filter=productid=` on
`entity/variant`; whether `entity/product` lists archived items; variant price inheritance; bundle stock
semantics; exact phone filter format; state change releasing reserves; PII transfer to MoySklad.
