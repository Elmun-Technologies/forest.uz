# Incident contacts & escalation (template — the Owner fills it in)

Keep this file free of personal phone numbers if the repository is shared beyond the core team;
then store the filled copy in the owner's password manager / shared drive and link it here.

## Roles during an incident

| Role | Who | Backup | Reach via |
|---|---|---|---|
| Incident owner (decides, communicates) | | | |
| Technical on-call (server, deploy, DB) | | | |
| Shop operator (customers, orders, couriers) | | | |
| Owner / business decisions, provider cabinets | | | |

Channels: Telegram ops chat `<name>` (incidents), Telegram admin alerts group (automatic alerts:
orders, payments, SLA, integrations, backups, deploys), phone tree for SEV1 at night.

## Severity

| | Meaning | Response |
|---|---|---|
| SEV1 | storefront/checkout/payments down, data loss, suspected breach or PII leak | page on-call now; status note in the bot/site within 30 min |
| SEV2 | one integration down (MoySklad, Eskiz, Yandex), degraded performance, single order/payment dispute | same business day |
| SEV3 | cosmetic / workaround exists | next working day |

Suspected personal-data breach: preserve evidence (no restarts that wipe logs: `docker compose logs >
file` first), revoke access (secret-rotation.md), inform the Owner at once. The Owner decides on the
notification to the authorities and affected customers under the Law "On personal data" (ZRU-547)
together with the lawyer (docs/13 open questions) — record the decision and times.

## Providers

| Provider | What for | Support contact | Account / merchant id | Cabinet URL |
|---|---|---|---|---|
| VPS / data centre (UZ) | server, network, snapshots | | | |
| UZ S3 provider | object storage, backup bucket | | | |
| Cloudflare | DNS, proxy, WAF | dashboard support | | dash.cloudflare.com |
| Domain registrar | forest.uz | | | |
| Payme Business | online payments, refunds | | merchant id | |
| Click | online payments, refunds | | service id | |
| Eskiz | SMS | | | |
| Yandex Delivery | Tashkent couriers | | | |
| BTS | regional delivery (manual mode) | | | |
| MoySklad | stock, prices, orders | | | |
| OFD / fiscal provider | fiscal receipts | | | |
| Telegram | bot (@…) | BotFather / @BotSupport | | |

## After the incident

Write a short post-mortem within 3 working days: timeline (Asia/Tashkent), impact (orders,
customers, money), root cause, what worked, actions with owners. Add new checks to the runbooks.
