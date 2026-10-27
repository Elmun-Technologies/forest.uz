# Launch checklist (docs/12 Phase 6)

Tick every line on the production VPS (or staging where stated) and note who/when. A line that
can't be ticked is a launch blocker unless the Owner writes an explicit waiver next to it.

## 1. Business readiness

- [ ] **Launch kit all green** — Admin → Integrations → launch kit: Payme, Click, COD flag,
      Yandex Delivery, BTS (manual), MoySklad, Eskiz, Telegram, IKPU — each CONNECTED/ready.
- [ ] **Payme / Click live keys** entered by the Owner (`mode=live`), endpoints set in the cabinets
      (`https://<API_DOMAIN>/v1/webhooks/payme`, `…/click/prepare`, `…/click/complete`); Payme
      sandbox suite passed on staging; one real 1 000 so'm payment + refund per provider
      (docs/runbooks/payments.md "Before go-live").
- [ ] **Fiscal receipts**: Payme `fiscalDetail` on, receipts show the right IKPU/package codes; COD
      receipt process agreed with couriers (docs/13 q.6/q.34).
- [ ] **IKPU complete** — no active variant with an empty or placeholder IKPU (A11 KPI = 0;
      `infra/backup/sanity.sql` style check:
      `SELECT count(*) FROM "Variant" v JOIN "Product" p ON p.id = v."productId" WHERE p.status='ACTIVE' AND v.active AND (v.ikpu IS NULL OR v.ikpu !~ '^[0-9]{17}$' OR v.ikpu = '00000000000000000')` → 0).
- [ ] **Real photos, prices, texts** — sample/seed catalogue replaced (no design sample data,
      no `[placeholder]`), prices from MoySklad, delivery prices/thresholds confirmed in
      Admin → Sozlamalar → Yetkazish (free-delivery threshold `[confirm]` in CLAUDE.md §11).
- [ ] **Legal reviewed** — oferta, privacy policy, returns reviewed by the lawyer; company data
      complete in Admin → Sozlamalar → Do'kon (the "draft" notice disappears); offer version bumped;
      personal-data localisation and register entry confirmed (docs/14, docs/13).
- [ ] Eskiz templates approved (every `smsApproved` template matches the Eskiz cabinet text).
- [ ] Message templates and bot texts reviewed in uz/ru; operator hours set.

## 2. Infrastructure & security

- [ ] **DNS/TLS**: `SITE_DOMAIN`, `ADMIN_DOMAIN`, `API_DOMAIN` (+ `CDN_DOMAIN` if the VPS serves
      images) resolve to the VPS / Cloudflare; certificates valid (Kuma TLS monitor green);
      `www` redirect decided; Cloudflare SSL mode Full (strict), HTML and `/api/*` **not cached**.
- [ ] `infra/deploy/deploy.sh preflight` clean; deployed from a tagged commit.
- [ ] **`DEV_ENDPOINTS=false`** and **`ALLOW_FAKE_PROVIDERS=false`**, `PROVIDERS_MODE=live`
      (preflight enforces; verify `curl -s -o /dev/null -w '%{http_code}' https://<API_DOMAIN>/v1/dev/outbox`
      → 404).
- [ ] **`TRUST_PROXY_HOPS`** matches the chain (1 = Caddy only; 2 = Cloudflare + `TRUSTED_PROXIES`
      from `infra/deploy/cloudflare-ips.sh`); check from two networks that OTP limits are separate
      (docs/runbooks/deploy-network.md).
- [ ] Firewall: only 22 (admin IPs), 80, 443 open (with Cloudflare: 80/443 from Cloudflare ranges only);
      SSH keys only, root login off; automatic security updates on; NTP synchronised
      (`timedatectl` → "System clock synchronized: yes").
- [ ] Disk encryption / provider encryption at rest confirmed with the hosting provider.
- [ ] `.env` and `.env.ops` mode 0600, owned by root; `APP_ENCRYPTION_KEY`, backup passphrases and
      `WEB_REVALIDATE_SECRET` stored in the Owner's password manager.
- [ ] **AuditLog append-only for the app role** — applied by `infra/deploy/db-roles.sql` on every
      deploy. Verify (SQL, no migration needed):
      ```sql
      -- as the owner: docker exec -it forest-postgres-1 psql -U forest forest
      SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'forest_app' AND table_name = 'AuditLog';      -- only INSERT, SELECT
      SELECT usename, count(*) FROM pg_stat_activity WHERE datname = 'forest' GROUP BY 1; -- API = forest_app
      ```
      Standalone equivalent (if the script ever can't run):
      `REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM forest_app;`
- [ ] API connects as `forest_app` (compose.prod.yml), not the owner.
- [ ] CSP check against production after the first deploy:
      `cd e2e && SITE=https://<site> ADMIN=https://<admin> OWNER_EMAIL=… OWNER_PASSWORD=… OWNER_TOTP_SECRET=… node csp-check.mjs` → passed;
      then try a Telegram login on `/uz/kirish` (verifies the widget policy, F-17).
- [ ] Admin: every staff member enrolled in TOTP (recommended for all roles, F-04);
      `ADMIN_ALLOWLIST` set if the team works from fixed IPs; owner's initial password changed.
- [ ] `pnpm audit --prod` clean on the release commit; gitleaks green in CI.
- [ ] Review the open ASVS findings (docs/security/asvs-l2.md) — High/Medium fixed or waived by the Owner.

## 3. Backups, monitoring, alerts

- [ ] **Backups verified**: `pgbackrest.sh info` shows a full backup and a continuous WAL range;
      `pg-dump.sh` uploaded and `cryptcheck` passed; objects backup ran; all four
      `forest-*.timer` enabled (`systemctl list-timers 'forest-*'`).
- [ ] **Restore drill done on this server**: `infra/backup/restore-drill.sh --from-remote` and
      `--pitr --target '<time>'` both passed; report kept in `/var/backups/forest/drills`;
      result added to docs/runbooks/restore-db.md.
- [ ] GlitchTip running on the monitoring VPS, `SENTRY_DSN` set, a test event arrived
      (docs/runbooks/monitoring.md §1) and contains no PII.
- [ ] Uptime Kuma monitors + push monitors configured; heartbeat URLs in `.env.ops`.
- [ ] **Alerts tested** end to end into the Telegram admin alerts group: Kuma (stop api 2 min on
      staging), backup failure (wrong bucket), deploy message, business alert (test order),
      integration error alert.
- [ ] Load test on staging with production-like hardware passed the thresholds
      (`loadtest/README.md`), numbers recorded; `WEB_REPLICAS` sized accordingly.
- [ ] Incident contacts filled in (docs/runbooks/incident-contacts.md); on-call knows
      deploy-and-rollback, payment-incident, moysklad-sync-failure, restore-db, secret-rotation.

## 4. Search & marketing

- [ ] **GSC and Yandex Webmaster verified** (Admin → SEO → verification codes; meta tags render on
      the home page), GSC/YWM integrations connected for query sync.
- [ ] **Sitemap submitted** in GSC and Yandex Webmaster (`https://<site>/sitemap.xml`);
      `robots.txt` correct (no leftover `noindex` override); IndexNow enabled (`/<key>.txt` answers).
- [ ] Ad platform integrations (Meta CAPI, Google Ads, TikTok) connected only after the cookie
      banner/consent texts are final; audiences reviewed.
- [ ] Analytics sanity: a test order appears in A1/A2 and attribution within minutes.

## 5. Go / no-go

- [ ] Rollback rehearsed on staging (`deploy.sh rollback`), the previous image present on production.
- [ ] Owner sign-off: ______________________  date: __________
