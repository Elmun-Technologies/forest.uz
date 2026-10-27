# Runbook · payment incidents (Payme, Click, COD)

Protocol details and business mapping: docs/runbooks/payments.md. Ground rules (docs/02, CLAUDE.md
§6): the **provider webhook is the only source of truth** for online payments — never mark an online
payment PAID by hand; the DB allows one PAID payment per order (trigger `Payment_one_paid`);
refunds of Payme payments happen in the Payme cabinet, Click and COD refunds are recorded in admin.

Severity: **SEV1** = customers can't pay online or money moved without an order update;
**SEV2** = a single order/refund dispute. Open the incident in the ops chat (incident-contacts.md),
one owner, notes with times (Asia/Tashkent).

## Where to look

| Signal | Where |
|---|---|
| Webhook calls and our answers | Admin → Integrations → Payme/Click log (`IntegrationLog`, `integrationKey` payme/click, `kind webhook.*`); `infra/deploy/compose.sh logs api \| grep webhooks/` (paths masked, no bodies) |
| Order / payment state | Admin → Buyurtmalar → order → timeline (`OrderEvent`), payments block |
| Errors | GlitchTip project `api`, route tags `/v1/webhooks/payme`, `/v1/webhooks/click/*` |
| Alerts | Telegram alerts group: "To'lov o'tmadi", integration errors (`bot.alerts.scan`) |
| Reachability | Uptime Kuma `api /ready`; from outside: `curl -s -X POST https://<API_DOMAIN>/v1/webhooks/payme -d '{}'` must answer HTTP 200 with a JSON-RPC error (auth), never 5xx/timeout |

## A. Webhooks down / provider can't reach us (SEV1)

Symptoms: checkout redirects to Payme/Click but orders stay NEW / "awaiting payment"; Payme
cabinet shows endpoint errors; Kuma alerts; no `webhook.*` rows in the integration log.

1. Is the API up? `infra/deploy/compose.sh ps`, `/ready` through Caddy. If a deploy just happened →
   `infra/deploy/deploy.sh rollback` (deploy-and-rollback.md).
2. TLS/DNS: certificate valid for `API_DOMAIN` (Kuma certificate monitor), DNS unchanged, Cloudflare
   not challenging the provider (Cloudflare → Security events: allow-list Payme/Click; bot-fight /
   "under attack" mode must be off for `API_DOMAIN`).
3. Auth: wrong/rotated credentials make every call fail with Payme `-32504` / Click sign error —
   check the integration log messages; re-enter the key in Admin → Integrations (Owner). Payme
   `ChangePassword` from the cabinet updates the stored key automatically (audited).
4. Payme `allowedIps` (optional field): if Payme changed IPs the calls are refused — clear the field
   or update it.
5. While down: Payme tells the payer the cashbox is unavailable (no money taken); Click prepare fails.
   Reservations expire after 30 min, customers can use "pay again" on the order page. Consider
   switching checkout to COD only (Admin → Integrations → disconnect the provider, or `flags`) and
   say so in the bot/site banner.
6. After recovery: reconcile (section E) for the outage window.

## B. Paid, but the order is not confirmed (SEV1/2)

1. Find the order (number = Payme `account.order_id` / Click `merchant_trans_id`).
2. Integration log for that order: did `PerformTransaction` / Click `complete` arrive and what did we
   answer? GlitchTip for a 5xx at that time.
3. Payme: if `CheckTransaction` state is 2 at Payme but our payment isn't PAID, Payme will retry
   Perform until it gets a success answer — fix the cause (deploy/rollback), the retry confirms it.
   Do **not** create a payment by hand.
4. Click: Click retries `complete`; if Click shows the payment as successful but retries are
   exhausted, contact Click support with `click_trans_id` and ask them to resend, or refund in the
   Click cabinet and ask the customer to pay again.
5. Customer communication: apologise via the bot/phone, give the order number; the order SMS goes
   out automatically once the payment is recorded.

## C. Double payment (SEV2)

What the system does: one PAID payment per order is enforced in the DB; a second Payme transaction
for an already paid order is refused at `CheckPerformTransaction`/`CreateTransaction`
(`-31008`/`-31050`), so Payme does not take the money. A double charge therefore means either two
orders (customer placed twice) or a provider-side duplicate.

1. Search admin orders by the customer's phone (Owner/Manager see full digits) for two paid orders
   with the same items/time.
2. Two orders: cancel the duplicate **with a refund**: Payme → cancel the transaction in the Payme
   cabinet (arrives as `CancelTransaction` −2 → payment REFUNDED, order cancelled, stock
   released); Click → reversal in the Click cabinet, then the refund action on the admin order page (records the
   refund, Idempotency-Key handled by the UI). Refused while a courier holds the parcel
   (`DELIVERY_IN_PROGRESS`/`-31007`): cancel the Yandex claim first or do a return after delivery.
3. Same order charged twice at the provider: provider support ticket with both transaction ids
   (Payme `GetStatement` for the day lists every transaction); refund the extra one in the cabinet.

## D. Refund disputes / chargebacks (SEV2)

1. Collect: order timeline, payments + refunds (`Refund` rows, staff id or `provider:payme`), fiscal
   receipt(s), delivery history (courier, BTS status), customer messages (bot inbox), audit log
   entries for the order (`/settings/audit`, entity Order).
2. Payme refunds can only be initiated in the Payme cabinet; partial refunds are not supported by
   Payme `CancelTransaction` (full only) — for partial amounts agree a Click/cash refund or a
   voucher.
3. Fiscal: a refund needs a refund receipt at the OFD/fiscal provider (docs/13 q.6); record it.
4. Answer the provider's dispute with the timeline and the delivery proof within their deadline.

## E. Reconcile after any payment incident

For the incident window (UTC):
```sql
-- run as forest_ro (read-only) on the server: docker exec -it <postgres> psql -U forest_ro forest
SELECT o.number, p.method, p.status, p."providerTxnId", p."amountTiyin", p."updatedAt"
FROM "Payment" p JOIN "Order" o ON o.id = p."orderId"
WHERE p."updatedAt" BETWEEN '<from>' AND '<to>' AND p.method IN ('PAYME','CLICK')
ORDER BY p."updatedAt";
```
Compare with Payme cabinet → Transactions (or the `GetStatement` the cabinet triggers) and the Click
cabinet report: every provider-successful transaction must be a PAID row; every PAID row must be
successful at the provider. Differences → B (missing) or C/D (extra). Record the outcome in the
incident notes.

## F. COD

- Cash collected but the order shows COD_PENDING after delivery: the "COD cash settled" action on the admin order page
  (`cod-paid`, only after hand-over).
- Fiscal receipt from the courier missing: the order can't be COMPLETED (`FISCAL_RECEIPT_REQUIRED`) —
  enter the receipt (Admin → order → fiscal receipt) once it arrives.
