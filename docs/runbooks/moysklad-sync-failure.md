# Runbook · MoySklad sync failure

How the sync works: docs/runbooks/moysklad.md and CLAUDE.md §6 (MoySklad decisions). MoySklad is
master for price, stock, SKU, IKPU and existence; our content stays ours. All sync work runs under
one Redis lease (`forest:moysklad:lock`); failures are rows in `IntegrationLog` (`moysklad`).

## Symptoms → first look

| Symptom | Look at |
|---|---|
| Alert "Integratsiya xatosi: moysklad" (bot alerts group, ≤ 1/h) | Admin `/moysklad` → log (filter `ok=false`) |
| Prices/stock on the site differ from MoySklad | `/moysklad` status: last reconcile / stock poll times; stock flow on? |
| Orders not appearing in MoySklad | `/moysklad` → orders block (`MoyskladOrderLink.lastError`, attempts, next attempt) |
| Products went inactive unexpectedly | log rows of the last `moysklad.reconcile` (archived/deleted in MoySklad?) |

## Common causes

1. **Token revoked/expired** (HTTP 401): Owner re-enters the token in Admin → Integrations →
   MoySklad (audited); then "sync now" on `/moysklad`.
2. **Rate limit / parallel limit** (HTTP 429, `X-Lognex-Auth 429005`): retried automatically with
   backoff; persistent 429 means another integration on the same MoySklad account is hammering it —
   ask the owner which apps use the account; lower `stockPollMinutes` pressure (raise the interval).
3. **MoySklad outage / 5xx**: GETs retry, order pushes back off 1 min → 1 h by themselves. Nothing
   to do but watch; the hourly reconcile catches up. Status: https://status.moysklad.ru (if
   reachable).
4. **Settings drift** (price type, store, organization or a state name renamed in MoySklad):
   errors like "price type not found" / "state not found" — fix the mapping on `/moysklad`
   (Manager/Owner, `moysklad.edit`).
5. **Currency not UZS** / prices ≤ 0: rows are skipped with an error row by design; fix in MoySklad.
6. **Stock report empty or missing > 50 % of linked items**: the snapshot is ignored by design
   (protects against wiping stock) — check the configured store in MoySklad.
7. **Webhooks not arriving**: webhooks only speed things up (stock poll + hourly reconcile are the
   safety net). Re-register on `/moysklad` ("webhooks register"); the URL contains a secret token
   (Owner only).
8. **Lease stuck** (a crashed run): the lease expires on its own (TTL); after an API restart sync
   resumes. Do not delete Redis keys by hand unless the log shows no run for > 2 × the TTL.

## Order push stuck for a specific order

- `/moysklad` orders block shows the error. Typical: counterparty phone invalid, state mapping
  missing, a product not linked (`Variant.moyskladId` empty and SKU doesn't match `article`/`code`).
- Fix the cause, then "sync now" (scope orders) — the link row retries on its backoff anyway.
- Never create the `customerorder` by hand in MoySklad *and* let the sync push: the sync looks up an
  order by `name` = our order number first, so a hand-made one with the same name is adopted.

## Stock went wrong after an outage

1. Switch the stock flow off on `/moysklad` if MoySklad itself has wrong numbers (our admin then
   edits stock; `CATALOG_MOYSKLAD_READONLY` lifts for stock).
2. Correct stock in MoySklad, switch the flow on, "sync now" (scope stock).
3. Holds: orders pushed with `reserve` hold goods in MoySklad; cancelled/returned orders set the
   reserve to 0 automatically. Check reserves of cancelled orders in MoySklad if numbers look high.

## Escalate

- MoySklad support (account owner contacts them) with the request time and the `X-Request-Id` /
  error text from the log row.
- If the site oversells (stock shown > real): set the affected variants inactive in MoySklad or
  switch the products flow off and deactivate them in admin until fixed.
