# Runbook · monitoring, alerts, logs

Decisions: CLAUDE.md §6 "Error monitoring", "Uptime + ops alerts", "Log retention".

| Signal | Tool | Goes to |
|---|---|---|
| Server errors (api 5xx, web/admin render errors) | GlitchTip (self-hosted, UZ monitoring VPS) via `SENTRY_DSN` | GlitchTip alert rules → e-mail / webhook (§3) |
| Site/admin/API up, TLS expiry | Uptime Kuma (monitoring VPS) | Telegram admin alerts group |
| Backups and drills ran | Kuma push monitors ← `OPS_HEARTBEAT_URL_*`; scripts post failures themselves | Telegram admin alerts group |
| Deploy result / rollback | `deploy.sh` → `OPS_TELEGRAM_*` | Telegram admin alerts group |
| Business events: new order, failed payment, SLA risk, ≤ 3★ review, complaint, integration error | API `BotAlertsService` (`bot.alerts.scan` every minute) | Telegram admin alerts group (integration `adminChatId`) |
| CSP violations (optional) | `CSP_REPORT="; report-uri https://<glitchtip>/api/<project>/security/?sentry_key=<key>"` | GlitchTip "security" events |

## 1. GlitchTip (error monitoring)

Host: a second small VPS in Uzbekistan (2 vCPU / 4 GB). `infra/monitoring/compose.yml`:
```bash
cd /opt/forest/app/infra/monitoring && cp env.example .env && chmod 600 .env   # fill domains, generate secrets
docker compose up -d
docker compose exec glitchtip ./manage.py createsuperuser                      # first (only) admin
```
Registration and organisation creation are off. Create organisation `forest`, projects `api`,
`web`, `admin` (platform Node) and copy each DSN into the shop's `.env` as `SENTRY_DSN` (one DSN is
fine for all three — events carry a `service` tag; separate projects give separate alert rules).
Deploy the shop. Test from the API container (sends one event through the same reporter):
`infra/deploy/compose.sh exec api node -e "require('@forest/contracts').createErrorReporter({dsn: process.env.SENTRY_DSN, service: 'api', onSendError: console.error}).capture(new Error('glitchtip test'), {route: '/test', method: 'GET', status: 500})"`.
Real 5xx answers appear within seconds with route template, method,
status, release (= image tag) — **no body, headers, cookies, query, path values, user or IP** (the
reporter `packages/contracts/src/error-report.ts` builds the whole event; Prisma messages are cut to
their first line; phones/emails/tokens masked; ≤ 30 events/min per process).
Not collected: browser JavaScript errors (no SDK in the storefront bundle; the tracker's `js_error`
events in A2 cover them in aggregate), BullMQ job failures (logged + IntegrationLog + alerts) and
crashes (the container restarts; `docker compose logs`).
Retention: events 30 days (`GLITCHTIP_MAX_EVENT_LIFE_DAYS`).
Backups of the monitoring host: not required (no business data); Kuma's monitor list can be
exported from its UI (Settings → Backup).

## 2. Uptime Kuma

On the monitoring VPS (same compose). UI only from `KUMA_ALLOWLIST`; `/api/push/*` stays open.
Notification: Settings → Notifications → **Telegram**: bot token of the shop bot, chat id of the
admin alerts group (same as Admin → Integrations → Telegram `adminChatId`). Apply to all monitors.

Monitors (interval 60 s, retries 2, so a single blip doesn't page):
| Name | Type | Target | Expect |
|---|---|---|---|
| Storefront | HTTP(s) keyword | `https://<site>/uz` | 200, keyword `Forest` |
| Checkout page | HTTP(s) | `https://<site>/uz/savat` | 200 |
| API ready | HTTP(s) | `https://<api>/ready` | 200 (`db` + `redis` ok) |
| Payme endpoint | HTTP(s) POST | `https://<api>/v1/webhooks/payme`, body `{}` | 200 (JSON-RPC error = alive) |
| Admin | HTTP(s) | `https://<admin>/login` | 200 |
| TLS | (built into each HTTP monitor) | certificate expiry notification | 14 days before |
| backup-db / pgbackrest / backup-objects | Push | heartbeat interval 25 h | missed = alert |
| restore-drill | Push | heartbeat interval 32 days | missed = alert |
Copy each push URL into `.env.ops` as `OPS_HEARTBEAT_URL_<JOB>` (BACKUP_DB, PGBACKREST,
BACKUP_OBJECTS, RESTORE_DRILL). Optional public status page: Kuma → Status pages (no internal
monitors on it).

## 3. Alert routing to Telegram

- Kuma → Telegram natively (above).
- Ops scripts → `OPS_TELEGRAM_BOT_TOKEN` / `OPS_TELEGRAM_CHAT_ID` in `.env.ops` (plain text, no PII:
  host, job, exit code).
- Business alerts → API `BotAlertsService` (needs the Telegram integration CONNECTED and
  `adminChatId` set).
- GlitchTip → e-mail (set `GLITCHTIP_EMAIL_URL`), or a GlitchTip "webhook" alert to a chat bridge.
  GlitchTip's webhook speaks the Slack/Discord format, which Telegram doesn't accept; without a
  bridge use e-mail and rely on Kuma + business alerts for paging.
- Test all routes before launch (docs/launch-checklist.md): stop the api container on staging for
  2 min (Kuma alert), run `infra/backup/pg-dump.sh` with a wrong bucket (script alert), deploy a
  release (deploy alert), place a test order (business alert).

## 4. Logs and retention

| Log | Where | Retention |
|---|---|---|
| Container stdout (pino JSON access/app logs, Next, Caddy, Postgres) | Docker json-file | 20 MB × 5 per container (`compose.prod.yml`) ≈ days to weeks depending on traffic |
| Ops timers (backups, drills) | journald | 30 days / 1 GB (`infra/deploy/journald-forest.conf`) |
| Postgres slow queries (≥ 500 ms, no bind values) | postgres container log | as above |
| Integration calls / webhooks | DB `IntegrationLog` | in DB (no purge job yet) |
| Staff actions | DB `AuditLog` | kept; append-only for the app role |
| Errors | GlitchTip | 30 days |
| Uptime history | Kuma | 90 days (Settings → Monitor history) |

Access logs contain method, masked path (no query string; webhook path secrets masked), status and
timing — no IPs, cookies or bodies (`common/redact.ts`). Search them with
`infra/deploy/compose.sh logs --since 2h api | grep '"statusCode":5'`.
Slow-query review: `SELECT … FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20` (as
`forest`); reset after releases with `SELECT pg_stat_statements_reset()`.
