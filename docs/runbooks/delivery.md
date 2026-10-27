# Runbook · Delivery (Yandex Delivery — Tashkent express)

Code: `apps/api/src/integrations/providers/yandex-delivery.ts` (pure request builders, status
mapping, HTTP adapter), `apps/api/src/delivery/yandex-shipment.service.ts` (claim lifecycle, sync,
order transitions, notifications), `apps/api/src/delivery/delivery.module.ts` (BullMQ `delivery`
queue, status callback), `apps/api/src/delivery/delivery-quote.service.ts` (live checkout quote).
Tests: `apps/api/src/integrations/providers/yandex-delivery.test.ts`,
`apps/api/test/delivery.int.test.ts` against a local stub of the API (`apps/api/test/yandex-stub.ts`).
BTS (manual mode) is documented separately by its own runbook.

## Source of truth (2026-10-27)
The official documentation (`yandex.com|yandex.ru/support/delivery-profile/…/api/express/…`,
`yandex.ru/dev/logistics/api/…`) is unreachable from the dev environment (DNS blocked). The protocol
was built from (a) the official pages' text as returned by web search, and (b) three independent
open-source clients, read only (downloaded into an isolated scratch directory):

| # | Source | Version / pin | Used for |
|---|---|---|---|
| A | Official docs (search snippets): Create claim `openapi/IntegrationV2ClaimsCreate`, Confirm claim `…ClaimsAccept`, Get claim information `…ClaimsInfo`, Terms of cancellation `…ClaimsCancelInfo`, Cancel the claim `…ClaimsCancel`, Check price `…CheckPrice`, Changelog `…ClaimsJournal`, Status model `claim-process`, Quickstart, FAQ | fetched 2026-10-27 | host, paths, `request_id` semantics, two-step create/accept, ~10 min offer, cancel rules, statuses, callback behaviour, token |
| B | npm `mcp-yango-delivery` (A1-x-Tech, MIT) — `dist/client.js`, `dist/tools/claims.js`, `dist/tools/tracking.js`; same authors' `mcp-yandex-dostavka@1.1.0` only cross-read | `1.1.0` (https://registry.npmjs.org/mcp-yango-delivery/-/mcp-yango-delivery-1.1.0.tgz) | query vs body placement, idempotent/retry classification, status list, points-eta / voiceforwarding / tracking shapes, 409 codes |
| C | PyPI `yandex-delivery-api` (edm.rud3nko) — `yandex_delivery/delivery_api.py`, `base_methods.py`, `rest_adapter.py` | `1.0.3` (https://files.pythonhosted.org/packages/0c/38/d92f3b5016ebca69f0f331cbc7ee0b01d68a8bdd8f115ebb281fd7065d7e/yandex-delivery-api-1.0.3.tar.gz) | claim body model (route points, contact, address, items, client_requirements, callback_properties), query params |
| D | Go `github.com/vildan-valeev/yandexdelivery` — `methods.go`, `requests.go`, `models/*.go` | `v0.0.6` @ `8dde43f32aadcba4721a5a728fca1ab164b01cca` (proxy.golang.org) | response models (claim info, performer_info, pricing, cancel-info, journal, voiceforwarding), status enum, error body `{code, message}` |

A fourth client, npm `yandex-delivery-sdk@0.1.3`, sends `claim_id`/`request_id` in the JSON body;
it contradicts A–D and was disregarded.

## Protocol we rely on
Host `https://b2b.taxi.yandex.net` (env `YANDEX_DELIVERY_API_URL`, overridden only by tests), prefix
`/b2b/cargo/integration/v2/`. Headers: `Authorization: Bearer <OAuth token>`, `Accept-Language: ru`,
`Content-Type: application/json`. Errors: non-2xx with `{code, message}`.

| Call | Request | We read | Retries |
|---|---|---|---|
| `POST check-price` | body `{items:[{quantity, weight(kg), pickup_point:1}], route_points:[{id, coordinates:[lng,lat], fullname}×2], requirements:{taxi_class}}` | `price` (decimal string), `currency_rules.code` (must be `UZS`), `eta` | yes (read-only) |
| `POST claims/create?request_id=<id>` | body `{items[{title, quantity, cost_value "329000.00", cost_currency "UZS", weight, pickup_point:1, extra_id}], route_points[{point_id, visit_order, type source/destination, contact{name, phone}, address{fullname, coordinates?}, external_order_id}], client_requirements{taxi_class}, emergency_contact, comment?, callback_properties{callback_url}?}` — never `auto_accept` | claim (`id`, `status`, `version`) | yes — same `request_id` returns the same claim (A: "use the same value to retry on 5xx/timeout") |
| `POST claims/info?claim_id=` | empty | `status`, `version`, `updated_ts`, `pricing.{final_price, offer.price, currency}`, `performer_info.{courier_name, car_model, car_color, car_number, transport_type}`, `error_messages[]` | yes |
| `POST claims/accept?claim_id=` | `{version}` | 2xx; 409 `old_version` / `inappropriate_status` / `offer_expired` | **no** (dispatches a courier); on an unknown outcome we re-read claims/info |
| `POST claims/cancel-info?claim_id=` | empty | `cancel_state` free / paid / unavailable, `price` | yes |
| `POST claims/cancel?claim_id=` | `{version, cancel_state}` | 2xx → claim `cancelled` / `cancelled_with_payment` | **no** |
| `POST claims/points-eta?claim_id=` | empty | `route_points[type=destination].visited_at.expected` | yes, best effort |
| `POST driver-voiceforwarding` | `{claim_id}` | `phone`, `ext`, `ttl_seconds` (temporary forwarded number) | yes, best effort |
| `POST claims/search` | `{offset:0, limit:1}` | 2xx = token works (health check) | yes |

Idempotency: `request_id` = `<shipmentId>-<seq>`, stored in `Shipment.providerData.pendingRequestId`
**before** the call; a 4xx clears it (nothing was created), a timeout/5xx keeps it so the retry — or
the operator's next click after a crash — gets the same claim. A cancelled/failed claim is replaced
by `seq + 1`.

## Status mapping (Yandex claim → `DeliveryStatus` → order)
| Yandex | DeliveryStatus | Order (via `OrderLifecycleService.advanceForDelivery`) | Customer SMS |
|---|---|---|---|
| new, estimating, ready_for_approval, accepted, performer_lookup, performer_draft | CREATED | — | — |
| performer_found, pickup_arrived, ready_for_pickup_confirmation | COURIER_ASSIGNED | — | — |
| pickuped | PICKED_UP | → HANDED_TO_COURIER (walks CONFIRMED → PACKING → READY first) | `order_courier` with `{vaqt}` = ETA (points-eta), else `order_shipped` |
| delivery_arrived, ready_for_delivery_confirmation, pay_waiting | IN_TRANSIT | → HANDED_TO_COURIER | (as above if first) |
| delivered, delivered_finish | DELIVERED | → DELIVERED | `order_delivered` only (no "on the way" for a jump) |
| returning, return_arrived, ready_for_return_confirmation | FAILED | → HANDED_TO_COURIER (the parcel left even if `pickuped` was never seen) | `order_delivery_failed` — at most once per shipment, never "on the way" |
| returned, returned_finish | RETURNED | → RETURNED (stock hold released) | — |
| cancelled_with_items_on_hands | FAILED (terminal) | → HANDED_TO_COURIER + `DELIVERY_NEEDS_ATTENTION` | `order_delivery_failed` (once) |
| estimating_failed, performer_not_found, failed, cancelled, cancelled_with_payment, cancelled_by_taxi | FAILED | — before pickup (staff may create a new claim); after pickup `DELIVERY_NEEDS_ATTENTION` | — |
| unknown status | unchanged (warning logged) | — | — |

Transitions are checked against the delivery state machine (`canTransitionDelivery`); an
impossible jump is ignored with a warning. Every change appends `Shipment.history`
(`{at, status, providerStatus}`), writes `OrderEvent` `DELIVERY_STATUS` (actor CARRIER) and, for
SMS, a `DELIVERY_NOTICE` marker (`{template, delivery, shipmentId}`) in the same transaction.
A CANCELLED order whose parcel still moves (pickup or later) gets `DELIVERY_NEEDS_ATTENTION`
(`reason cancelled_order_parcel_moved`) and an error log — the order is not changed.

**Cancel / refund guard:** while a claim is accepted (or an accept is in flight) and not dead, or
any shipment is COURIER_ASSIGNED…DELIVERED, the order can't be cancelled (`DELIVERY_IN_PROGRESS`)
and a full refund is refused (`REFUND_NOT_ALLOWED`, Payme `-31007`). Cancel the claim first
(`cancelClaim`), then refund.

## Operations
- **Create claim** (Phase 3 admin "Kuryer chaqirish"): `YandexShipmentService.createClaim(orderId,
  actor)` — order must be CONFIRMED/PACKING/READY and carrier YANDEX; COD only with `allowCod=on`.
  Yandex estimates the claim (`ready_for_approval`); nothing is dispatched.
- **Accept**: `acceptClaim(shipmentId, actor)` — refused with `DELIVERY_TEST_MODE` while the
  integration is in `mode=test`. Step 1 under the order → shipment locks writes
  `providerData.acceptRequest {by, at, claimId}` (a second click within 2 min is a no-op); step 2
  calls Yandex outside any transaction; step 3 records `acceptedAt` + `DELIVERY_ACCEPTED` (staff
  actor) and clears the marker (also on failure). A claim accepted in the Yandex cabinet is
  detected and recorded. The offer is valid ~10 minutes: accept soon after creating, else
  `DELIVERY_CLAIM_NOT_READY` → cancel and create again.
- **Cancel**: `cancelClaim(shipmentId, actor, { allowPaid })` — `DELIVERY_CANCEL_PAID` until staff
  confirms the fee, `DELIVERY_CANCEL_UNAVAILABLE` after the courier has the parcel (Yandex support).
- **Sync**: queue `delivery`, job `delivery.shipments.sync` every minute: shipments whose
  `nextSyncAt` is due (≤ 50 per run), each leased by a conditional update. Cadence 1 min, 5 min while
  waiting for acceptance, stop on a terminal status; errors back off 1 → 2 → 4 … ≤ 30 min
  (`syncFailures`). Answers older than the stored `updated_ts` are ignored. A claim still awaiting
  acceptance stops being polled 24 h after creation (`providerData.claimCreatedAt`; no offer-expiry
  field is documented) or once its order is CANCELLED; accept/refresh restart it.
- **Failed after pickup** (`DELIVERY_NEEDS_ATTENTION`, `reason failed_after_pickup`): the claim
  died while the parcel was out and no return was reported. Find the parcel; once it is back in the
  warehouse call `markReturned(shipmentId, actor)` (shipment + order RETURNED, stock hold
  released). No new claim is allowed for a HANDED_TO_COURIER order (conservative: re-delivery of a
  parcel whose whereabouts are unknown is a Phase 3 admin decision).
- **Callback** (optional, `callbacks=on`): `POST https://<API_DOMAIN>/v1/webhooks/yandex-delivery?key=<secret>&`
  is sent as `callback_properties.callback_url`; Yandex appends `claim_id`/`updated_ts`. Wrong key →
  403, unknown claim → 200; a known claim enqueues `delivery.shipment.refresh` (deduplicated). The
  key is `HMAC-SHA256(APP_ENCRYPTION_KEY, "yandex_delivery:callback")[:40]` — rotating the app key
  changes the URL of claims created afterwards.
- **Live quote** (zone `liveQuote: true`, default off): `check-price` from the warehouse to the
  customer's pin; cached 10 min in Redis (`dq:yandex:<zone>:<lat4>:<lng4>:<0.5 kg step>`); any miss →
  zone price. Own HTTP client/breaker (`yandex_delivery:quote`, no retries, 3 s), so quotes never
  open the claims breaker; a failed pin (3-decimal rounding) is cached 60 s; requests with a pin
  (`GET /cart?zone&lat&lng`, `GET /cart/quote?…&lat&lng`) are limited to 30/min per IP.
- **Tracking page**: courier first name, car, plate, ETA window, carrier history; the forwarded
  courier number (+ext) only to the order owner (session customer or the placing browser's `fr_ord`
  cookie), masked for anyone else holding the link, hidden outside COURIER_ASSIGNED…IN_TRANSIT or
  after its TTL (30 min when Yandex sends none; dropped when the performer changes). Once a live
  claim exists — or a create whose answer was lost (`pendingRequestId`) — the address can't be
  changed online (`ADDRESS_LOCKED`). An address change runs under the order lock and drops the
  checkout pin (the new line has no coordinates).

## Owner must provide (admin → Integrations → Yandex Dostavka)
`oauthToken`, `sourceAddress`, `sourceLat`, `sourceLng`, `sourceContactName`, `sourceContactPhone`,
`taxiClass` (express | courier | cargo, default express), `callbacks` (off until q.40 is answered),
`allowCod` (off until q.41), `mode` (`test` first, `live` to dispatch). Plus the contract/tariff
(q.37) and Eskiz approval of the delivery SMS texts.

## NOT verified (open questions 37–47)
1. Availability/billing for Uzbekistan in UZS and the right tariff class (q.37).
2. `droppof_point` vs `dropoff_point` (we send neither with one destination) (q.38).
3. Whether destination coordinates are mandatory; `[lng, lat]` order (q.39).
4. Callback parameters/method/retries/IPs; callbacks unsigned (q.40).
5. COD collection by Yandex couriers in UZ (q.41); recipient SMS / confirmation codes (q.42).
6. Rate limits (q.43); free/paid cancellation window and un-accepted offer expiry (q.44).
7. Semantics of `performer_draft`, `pay_waiting`, `*_finish`, `cancelled_with_items_on_hands` (q.45).
8. `claims/info.eta` units (unused — we take the ETA from `points-eta`).

## Before go-live checklist
- [ ] Contract + token; integration connected in `mode=test` (health check green).
- [ ] One real claim created in test mode and inspected in the Yandex cabinet (price in UZS,
      addresses, contact, comment), then cancelled.
- [ ] Switch to `live`, one real delivery to a staff address: accept → courier → pickup → delivered;
      order transitions + SMS checked; tracking page shows courier for the owner only.
- [ ] Decide `callbacks` (q.40), `allowCod` (q.41) and `liveQuote` (q.47).

## Incident notes
- "Courier not coming": check `Shipment.providerStatus` / `syncFailures` / `nextSyncAt`, then
  `IntegrationLog` (`integrationKey = yandex_delivery`, kinds `claims.create|accept|cancel|info`).
- `performer_not_found` / cancelled by Yandex → shipment FAILED, order untouched: create a new claim.
- Stuck sync (many `syncFailures`): token revoked (password change invalidates it — docs) → reconnect.
