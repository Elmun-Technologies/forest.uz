# OWASP ASVS 4.0.3 — Level 2 review (Phase 6)

Scope: storefront (`apps/web`), admin (`apps/admin`), API/webhooks/jobs/bot (`apps/api`), shared
contracts, production infrastructure (`infra/`). Reviewed 2026-10-27 against the code on disk (claims
were checked by reading the cited files, running the production compose locally and the CSP
check `e2e/csp-check.mjs`; `pnpm audit --prod --audit-level high` → no known vulnerabilities).
Requirements that don't apply (no GraphQL, no WebSockets, no deserialisation of user objects, no
OAuth server, no SOAP/XML) are omitted. Legend: ✅ met · ⚠️ partly / with a documented trade-off
· ❌ gap → finding at the end (F-xx).

## V1 Architecture, design, threat modelling

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1.1.2 | Threat model / security design per change | ⚠️ | decisions with "why" in CLAUDE.md §6, docs/14; no formal threat model document |
| 1.2.1 | Unique low-privilege OS/service accounts | ✅ | images run as `app` (`infra/docker/*.Dockerfile` `USER app`); DB roles `forest` / `forest_app` / `forest_ro` (`infra/deploy/db-roles.sql`) |
| 1.2.2 | Communications between components authenticated | ✅ | API↔web signed (`WEB_REVALIDATE_SECRET`, `seo/revalidate-signature.ts`, `apps/web/src/lib/web-signature.ts`); DB/Redis/S3 credentials; Redis only on the `internal` network |
| 1.4.1 | Access control enforced server-side at trusted points | ✅ | `admin/auth/admin.guard.ts` (`AdminCsrfGuard`, `AdminAuthGuard`, `PermissionsGuard`), default-deny `@AdminController` + integration test walking every route |
| 1.5.x / 1.6.x | Input and crypto architecture centralised | ✅ | zod contracts (`packages/contracts/src/schemas`), `ZodPipe` (`common/http.ts`); one `SecretBox` (`integrations/crypto/secret-box.ts`) |
| 1.6.2 | Key management / rotation designed | ✅ | `APP_ENCRYPTION_KEY_PREVIOUS` → one keyring for every `SecretBox` (`keyringFromEnv`), re-encryption command `rotate-keys` (`integrations/crypto/rotate-keys.ts`, `test/key-rotation.int.test.ts`); procedure `docs/runbooks/secret-rotation.md` §1 — F-02 fixed |
| 1.14.1 | Segregation of components by trust | ✅ | `compose.prod.yml`: only Caddy publishes ports; `internal` network without egress for Redis |
| 1.14.6 | No unsupported client-side tech | ✅ | none |

## V2 Authentication

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 2.1.1/2.1.2 | Passwords ≥ 12 chars, ≤ 128 allowed | ✅ | `passwordProblems` (`packages/contracts/src/admin.ts`), used by invite accept |
| 2.1.7 | Breached/common password check | ⚠️ | common-password list in `passwordProblems`; no breached-corpus (k-anonymity) check |
| 2.1.9 | No composition rules | ✅ | length + common list only |
| 2.2.1 | Anti-automation | ✅ | admin: 10 failures → 15 min lock, 20/15 min per IP (`ADMIN_AUTH_POLICY`); OTP: 1/60 s, 5/h per IP, 5/h & 10/day per phone, 15 failed verifies/day (`customer/auth/otp-code.ts`) |
| 2.2.3 | Notify user after auth changes | ❌ | no e-mail/Telegram notice on staff password/TOTP change → **F-15** |
| 2.4.1 | Passwords stored with an approved KDF | ✅ | argon2id (`admin/auth/admin-auth.service.ts`, library defaults: m=64 MiB, t=3, p=4) |
| 2.4.x | Unknown accounts don't leak via timing | ✅ | dummy argon2 verify (`admin-auth.service.ts`) + generic `ADMIN_LOGIN_FAILED` |
| 2.5.x | Credential recovery | ✅ | no self-service reset; Owner re-invites/resets TOTP (72 h single-use sha256 invite tokens) |
| 2.7.1–2.7.3 | Out-of-band (SMS OTP) codes expire, single use | ✅ | 5 min TTL, `usedAt`, 5 attempts per code (`otp.service.ts`); codes HMAC-peppered at rest (`otp-code.ts`) |
| 2.7.6 | OOB code ≥ 20 bits entropy | ❌ | 4-digit code (13.3 bits) by design (4 input cells) → **F-03** |
| 2.8.1/2.8.4 | TOTP time-window and no replay | ✅ | `admin/auth/totp.ts` (RFC 6238, ±1 step), conditional UPDATE on `totpLastUsedStep` |
| 2.8.x | MFA for administrative access | ⚠️ | mandatory for Owner/Manager only (`TOTP_REQUIRED_ROLES`) → **F-04** |
| 2.9 / 2.10 | Service credentials not hard-coded | ✅ | integration credentials encrypted in DB; infra secrets in `.env` (generated on the server; gitleaks in CI) |

## V3 Session management

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 3.1.1 | No session tokens in URLs | ✅ | cookies only (`common/session.ts`, `admin-session.service.ts`) |
| 3.2.1 | New token on authentication | ✅ | rotation on login (customer), after login / TOTP / invite accept (admin) |
| 3.2.2 | ≥ 64 bits entropy | ✅ | random opaque ids in Redis (`sess:<id>`, `adm:<id>`) |
| 3.3.1 | Logout invalidates server-side | ✅ | `SessionService.destroy` deletes `sess:<id>`; admin logout deletes `adm:<id>` |
| 3.3.2 | Re-authentication after idle/absolute time | ⚠️ | admin 12 h absolute ✅; customer 90 d sliding → **F-10** |
| 3.3.3 | Option to terminate other sessions after password change | ⚠️ | admin: deactivation/TOTP reset kills all sessions (`adm:staff:<id>`); customers can't see/end other sessions → **F-10** |
| 3.4.1–3.4.3 | Secure, HttpOnly, SameSite | ✅ | customer `httpOnly`, `secure` (production), `SameSite=Lax`; admin `SameSite=Strict`, host-only |
| 3.4.4 | `__Host-` prefix | ❌ | not used → **F-11** |
| 3.5.x | Stateless tokens | n/a | opaque server-side sessions; signed links (cart restore, deep links, unsubscribe) are HMAC, time-bound |
| 3.7.1 | Re-auth / confirmation for sensitive actions | ⚠️ | erase needs typed `C-…` confirmation, refunds need Idempotency-Key + permission; no step-up re-auth |

## V4 Access control

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 4.1.1/4.1.2 | Server-side, attributes not user-modifiable | ✅ | Staff row re-read per request (`AdminAuthGuard`); permissions, not roles (`packages/contracts/src/admin.ts`) |
| 4.1.3 | Least privilege | ✅ | RBAC matrix (CLAUDE.md §6), masked PII by default, `POST …/reveal` audited |
| 4.1.5 | Fails securely | ✅ | undecorated admin routes rejected at runtime; dev endpoints 404 unless switch + token (`common/dev-endpoints.ts`) |
| 4.2.1 | IDOR protection | ✅ | orders by unguessable `publicId`/tracking token + owner check (`commerce/orders.controller.ts` `viewerFor`); `/me/*` from the session |
| 4.2.2 | CSRF | ✅ | admin double-submit token + Origin check (`AdminCsrfGuard`); storefront SameSite=Lax + JSON + CORS allowlist (`bootstrap.ts`); cart restore GET only for top-level navigations |
| 4.3.1 | Admin interfaces use MFA | ⚠️ | see 2.8 → **F-04**; optional edge allowlist `ADMIN_ALLOWLIST` (Caddy) |
| 4.3.2 | No directory browsing / metadata exposure | ✅ | Next/Caddy serve no listings; `.git`, `.env` not in images (`.dockerignore`) |

## V5 Validation, sanitisation, encoding

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 5.1.1 | HTTP parameter pollution | ✅ | zod schemas on query/body (`ZodPipe`) |
| 5.1.3/5.1.4 | Positive validation, typed | ✅ | zod (`packages/contracts/src/schemas/*`); tracker events per-type whitelists (`tracking/`) |
| 5.1.5 | Redirects allow-listed | ✅ | `/fake-pay` ignores `return`; safe `next` in login (`useAfterLogin`); `/tg` → fixed t.me host |
| 5.2.1 | Untrusted HTML sanitised | ✅ | no user HTML: CMS = structured blocks (`article-blocks.tsx` renders without `dangerouslySetInnerHTML`) |
| 5.2.6 | SSRF | ✅ | outbound webhooks: `webhooks-out/url-guard.ts` + vetted address in-connection (`http-post.ts`); heatmap snapshot only `WEB_INTERNAL_URL` storefront pages; provider hosts fixed by env |
| 5.2.7 | SVG/scriptable uploads | ✅ | only JPEG/PNG/WebP by magic bytes (`admin/files/image-meta.ts`); CDN site `Content-Security-Policy: default-src 'none'; sandbox` (`infra/Caddyfile`) |
| 5.3.1/5.3.3 | Context-aware output encoding | ✅ | React escaping; JSON-LD escapes `<` (`apps/web/src/components/json-ld.tsx`) |
| 5.3.4/5.3.5 | Parameterised queries | ✅ | Prisma + tagged `$queryRaw`; no `$queryRawUnsafe`; `Prisma.raw` only with constants / whitelisted aliases (`admin/analytics/sql.ts` `alias()`) |
| 5.3.x | CSV/formula injection | ✅ | exports prefix `= + - @` (`admin/customers/customers.service.ts`, `admin/orders/admin-orders.service.ts`) |
| 5.5.x | Deserialisation | ✅ | JSON only; replay chunks parsed and re-serialised (`heatmaps` ingest) |

## V6 Stored cryptography

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 6.1.1/6.1.3 | Sensitive data encrypted at rest | ⚠️ | integration credentials, staff TOTP, webhook secrets: AES-256-GCM (`secret-box.ts`); PII columns plain in Postgres (disk encryption = hosting provider, owner action) |
| 6.2.1/6.2.2 | Approved algorithms, authenticated modes, fail securely | ✅ | AES-256-GCM, random 96-bit IV, AAD per record; HMAC-SHA256 signatures with `timingSafeEqual` |
| 6.2.4/6.2.5 | Crypto agility / key rotation | ⚠️ | master key rotatable (F-02 fixed); **F-07** (`SESSION_SECRET`) open |
| 6.3.1 | CSPRNG | ✅ | `crypto.randomBytes/randomInt` (OTP, ids, tokens, secrets) |
| 6.4.1/6.4.2 | Key management, keys not exposed to clients | ⚠️ | web never gets `APP_ENCRYPTION_KEY` (dedicated `WEB_REVALIDATE_SECRET`); keys live in `.env` on disk (0600, owner action) — no KMS |

## V7 Errors and logging

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 7.1.1/7.1.2 | No credentials/PII in logs | ✅ | pino redact paths + request serializer with masked path, no query (`common/redact.ts`); Postgres slow log without bind values (`compose.prod.yml`); GlitchTip events built by `packages/contracts/src/error-report.ts` (no bodies/headers/cookies/IPs; verified against a fake intake) |
| 7.1.3/7.2.1 | Security events logged | ⚠️ | AuditLog: successful logins, logout, lockout, TOTP, PII reveals, exports, every admin mutation (`admin/audit/audit.service.ts`); failed logins are not audited → **F-08** |
| 7.1.4 | Logs have enough context | ✅ | request id, actor, ip, user agent in AuditLog |
| 7.3.1 | Log injection | ✅ | structured JSON logs |
| 7.3.3 | Audit log protected | ✅ | app role has no UPDATE/DELETE/TRUNCATE on `AuditLog` (`infra/deploy/db-roles.sql`, verified as `forest_app`) |
| 7.3.4 | Time sources synchronised | ⚠️ | host NTP (owner action, launch checklist) |
| 7.4.1 | Generic error messages | ✅ | `ApiExceptionFilter` (`common/http.ts`) → localized code/message, stack only in logs |

## V8 Data protection

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 8.1.1 | Sensitive data not cached by intermediaries | ⚠️ | API sets `no-store` on cart/orders/me/customers…; many admin GETs don't → edge default `?Cache-Control: no-store` on admin `/api/*` (Caddy) — **F-09**; cacheable HTML with `Set-Cookie` → **F-13** |
| 8.2.2 | No sensitive data in browser storage | ✅ | localStorage/sessionStorage: favourites, consent, popup state, replay decision (`apps/web/src/lib`) |
| 8.3.1 | Sensitive data in body/headers, not URL | ✅ | OTP/phone in bodies; capability URLs (`/t/<token>`, `/c/<token>`, `/obuna/<token>`) masked in logs and analytics |
| 8.3.2 | Users can export/delete their data | ✅ | `MeService.collectExport`, customer erase (`admin/customers/customer-erase.service.ts`) |
| 8.3.4 | Inventory / retention of personal data | ⚠️ | replays 30 d (`replays.purge`), backups ≤ ~35 d; raw events 13 m not enforced → **F-05**; IntegrationLog unbounded → **F-16** |
| 8.3.x | Data minimisation (analytics) | ✅ | no raw IP stored, PII-looking strings redacted at ingest (`tracking/`), hashed phones only to ad platforms |

## V9 Communications

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 9.1.1 | TLS for all client connections, HSTS | ✅ | Caddy automatic TLS, HSTS on every site (`infra/Caddyfile`) |
| 9.1.2/9.1.3 | Strong TLS config | ✅ | Caddy defaults (TLS 1.2/1.3, modern ciphers, OCSP stapling) |
| 9.2.1 | Outbound TLS verified | ✅ | providers https; webhooks https-only in production (`url-guard.ts`); pgBackRest verifies TLS |
| 9.2.2 | Internal connections encrypted | ⚠️ | plaintext inside one host's docker networks → **F-12** |

## V10 Malicious code / supply chain

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 10.3.1/10.3.2 | Integrity of dependencies and third-party scripts | ⚠️ | lockfile `--frozen-lockfile`, exact pins for rrweb/grammY/SDKs, gitleaks + `pnpm audit` in CI (`.github/workflows/ci.yml`); the Telegram widget is third-party JS without SRI (versioned query, allowed only on 2 pages) — accepted |
| 10.2.x | No backdoors / time bombs | ✅ | no dynamic code loading; `'unsafe-eval'` not allowed except on the Telegram-widget pages (**F-17**) |

## V11 Business logic

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 11.1.1–11.1.4 | Sequential steps, limits, anti-automation | ✅ | order/payment/delivery state machines (`packages/contracts`), checkout limits (`CHECKOUT_POLICY`), idempotency keys (checkout/refund/manual orders), one PAID payment per order (DB trigger), promo per phone/device |
| 11.1.5 | Business-logic limits documented | ✅ | CLAUDE.md §6, docs/02 |

## V12 Files and resources

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 12.1.1 | Size limits | ✅ | 10 MB uploads (`FileInterceptor`), bot photos ≤ 10 MB, replay chunks 512 KB/5 MB, tracker 64 KB, Caddy `request_body max_size 12MB` |
| 12.2.1 | Content type by content | ✅ | magic bytes (`admin/files/image-meta.ts`, bot photos) |
| 12.3.1–12.3.3 | No user-controlled paths | ✅ | keys `products/<id>/<cuid>.<ext>` generated server-side; `/sf` proxy rejects `%`, `\`, dot segments |
| 12.4.1 | Stored outside the web root, served safely | ✅ | S3 buckets; private bucket via 10-min signed URLs (`files/files.service.ts`) |
| 12.5.x | Metadata of uploaded images | ✅ | every stored image goes through `sanitizeImage` (`admin/files/image-meta.ts` → in-repo stripper `common/image-metadata.ts`: JPEG APPn/COM/trailers, PNG text/eXIf/tIME, WebP EXIF/XMP; unparsable files refused): admin uploads, bot photos, review photos on publication — F-01 fixed |
| 12.6.1 | SSRF on resource fetches | ✅ | see 5.2.6 |

## V13 API and web services

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 13.1.1 | Same encoding/parsers | ✅ | Nest/Express JSON, raw body kept for signatures (`main.ts` `rawBody`) |
| 13.1.3 | No sensitive data in API URLs | ✅ | see 8.3.1 |
| 13.1.4/13.1.5 | AuthZ on every route; content-type checks | ✅ | admin guards; replay upload only octet-stream/gzip (415); tracker text/plain only |
| 13.2.1 | Safe HTTP methods don't mutate | ✅ | admin rule "GETs never mutate"; PII reveal/export/replay open are POSTs |
| 13.2.2/13.2.3 | Schema validation, CSRF for REST | ✅ | zod; see 4.2.2 |
| 13.2.6 | Webhook authenticity | ✅ | Payme Basic auth (`integrations/providers/payme.ts` constant-time), Click md5 `sign_string` (`click.ts` constant-time), Telegram secret path + header, Eskiz/MoySklad secret path tokens, Yandex HMAC `key`; MoySklad payload never trusted (re-read) |
| 13.2.x | Partner API keys | ✅ | sha256-hashed keys, scopes, per-key rate limit (`partner/`) |
| 13.x | IP allowlists where providers publish them | ⚠️ | Payme optional `allowedIps`; Click none → **F-14** |

## V14 Configuration

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 14.1.1–14.1.3 | Repeatable, hardened builds | ✅ | multi-stage Dockerfiles, non-root, `tini`; `deploy.sh` builds from a clean commit and tags with the sha |
| 14.1.5 | Integrity of configuration | ✅ | `deploy.sh preflight` (https URLs, no fake providers/dev endpoints, secret strength, proxy-hop consistency) |
| 14.2.1 | Components up to date, audited | ✅ | `pnpm audit` CI job (clean on 2026-10-27); pinned majors by decision |
| 14.3.2 | Debug modes off | ✅ | `loadEnv` refuses fake providers/dev endpoints in production (`config/env.ts`); dev endpoints need token + switch |
| 14.3.3 | No version banners | ✅ | `x-powered-by` off (API, Next), Caddy strips `Server` |
| 14.4.1–14.4.7 | Security headers | ✅ | storefront/API/CDN in `infra/Caddyfile` (CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options, COOP); admin CSP in `apps/admin/next.config.ts`; verified on 27 storefront + 21 admin pages with 0 violations (`e2e/csp-check.mjs`) |
| 14.4.3 | CSP strength | ⚠️ | `script-src 'self' 'unsafe-inline'` (no nonce, by decision) → **F-06** |
| 14.5.2/14.5.3 | Origin/CORS | ✅ | CORS allowlist `APP_URL`, `ADMIN_URL` (`bootstrap.ts`); admin `Origin` check |

## Findings

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| F-01 | **High** (privacy) | Uploaded images keep EXIF/XMP metadata. docs/14 requires stripping EXIF/GPS from customer photos; nothing in `admin/files`, `bot/review-photos.ts` or review approval re-encodes or strips. Telegram re-encodes *photos* (metadata usually gone) but not images sent as *files*; staff uploads ("before" photos, product/CMS images) and any future storefront review form publish GPS/camera data. | Strip metadata at ingest for every upload path: re-encode with `sharp` (adds a native dep to the API image) or an in-repo segment stripper (JPEG APP1/APP13, PNG `eXIf`/`tEXt`/`iTXt`/`zTXt`, WebP `EXIF`/`XMP ` chunks), keeping orientation applied. Backfill existing public files. Unit tests with GPS-tagged fixtures. **Fixed** — in-repo stripper `common/image-metadata.ts` via `sanitizeImage` on every stored image (admin product/content/review-before uploads, bot photos, bot review photos again when published); unparsable files refused (`FILE_TYPE_UNSUPPORTED`); unit tests with GPS-tagged JPEG/PNG/WebP fixtures. Accepted: Exif orientation is dropped, not applied (no decoder in the API; CLAUDE.md §6). No backfill (pre-launch: seed/demo files only). |
| F-02 | **Medium** | `APP_ENCRYPTION_KEY` cannot be rotated: `SecretBox` supports previous keys and `needsRotation()`, but all four construction sites pass only `current`, no env carries previous keys, nothing re-encrypts; the Yandex callback key is derived from the same master key. A leak forces re-entering every credential and re-enrolling all TOTP (docs/runbooks/secret-rotation.md §1). | `APP_ENCRYPTION_KEY_PREVIOUS` (comma list) → one shared keyring provider for all `SecretBox` users; a one-off command/job re-encrypting rows where `needsRotation()`; derive the Yandex callback key from a dedicated secret (like `WEB_REVALIDATE_SECRET`). **Fixed** — `APP_ENCRYPTION_KEY_PREVIOUS` → `keyringFromEnv()` for all four `SecretBox` users; `node dist/scripts/rotate-keys.js` re-seals Integration credentials, staff TOTP and webhook secrets (idempotent, counts only); `test/key-rotation.int.test.ts`; runbook secret-rotation §1. The Yandex callback key stays derived from the master key (documented: earlier claims' callbacks are refused after a rotation, polling covers them). |
| F-03 | Medium | Customer SMS OTP has 4 digits (≈ 13 bits; ASVS 2.7.6 wants ≥ 20). Mitigated: 5 tries per code, 15 failed verifies/day/phone → lock, per-IP and per-phone send caps; an attacker gets ≈ 0.15 % per phone per day. | Prefer 6 digits (design change: 6 cells), or record a formal risk acceptance (decision log) and add an alert on lock events. |
| F-04 | Medium | TOTP is mandatory only for Owner/Manager. Operator and Warehouse accounts can view orders, reveal phones/addresses (audited) and edit orders with a password alone. | Make TOTP mandatory for every staff role (`TOTP_REQUIRED_ROLES` = all) or at least for any role holding `customers.pii*`/`orders.edit`. |
| F-05 | Medium | Raw analytics events are kept forever: `drop_old_event_partitions()` exists (migration init) but no job calls it; docs/14 promises 13 months. | Monthly job in the `maintenance` queue calling `drop_old_event_partitions(13)` (SECURITY DEFINER already granted by db-roles.sql); test with a fixed clock. **Fixed** — job `retention.prune` (daily 03:30) drops partitions > 13 months; integration test. |
| F-06 | Low–Medium | CSP allows inline scripts (`'unsafe-inline'`) on storefront and admin (decision: cached pages can't carry nonces). XSS protection relies on React escaping and the absence of user HTML. | Admin pages are all dynamic and authenticated: switch the admin to a nonce-based CSP via middleware (`strict-dynamic`), cheap there. Keep the storefront trade-off; review any new `dangerouslySetInnerHTML`. |
| F-07 | Low | `SESSION_SECRET` has no "previous" value: rotating it breaks unsubscribe links in marketing SMS already sent (opt-out must keep working), cart links (7 d) and signed `fr_ord`. | Accept `SESSION_SECRET_PREVIOUS` for verification of unsubscribe/cart/deep-link tokens; better: dedicated keys per purpose. |
| F-08 | Low | Failed admin logins are not written to AuditLog (only the lockout after 10). | Audit `auth.login_failed` for known staff (staff id, ip, ua) and rate-limited log lines for unknown e-mails (no e-mail stored). **Fixed** — `staff.login_failed` audit row per failure of a known staff account (step + count). |
| F-09 | Low | Many admin GET routes and some customer routes send no `Cache-Control`; mitigated at the edge (Caddy `?Cache-Control no-store` on admin `/api/*`). | Global Nest interceptor: `Cache-Control: no-store` default for `/v1/admin/*`, `/v1/me/*`, `/v1/orders/*`, `/v1/track/*`. |
| F-10 | Low | Customer sessions: 90-day sliding, no absolute lifetime, no list/"log out everywhere". | Absolute cap (e.g. 180 d), sessions index per customer (already has `sess:revoked:<id>`) and a cabinet "log out of all devices". |
| F-11 | Low | Session cookies lack the `__Host-` prefix. | `__Host-fr_admin` (already host-only, Secure, `Path=/`); storefront cookies are set through the same host — rename with a migration window. |
| F-12 | Low | Plaintext traffic inside the host (api ↔ postgres/redis/storage/web). Acceptable on one VPS with no published ports. | Keep single host; enable TLS (Postgres `ssl=on`, Redis TLS) if services ever span hosts. |
| F-13 | Low | Cacheable storefront HTML (`s-maxage=30`) can carry `Set-Cookie` (`fr_aid`, `fr_locale`) on a first visit; a shared cache told to ignore `Set-Cookie` would give many visitors one visitor id (promo device rule, attribution). | Keep Cloudflare from caching HTML (runbook); or issue `fr_aid` only on non-cacheable responses / API calls. |
| F-14 | Low | Click webhooks have no source-IP allowlist (Payme has an optional one); docs/14 asks for allowlists where providers publish them. | Optional `allowedIps` for Click like Payme (`ipAllowed`). Signature check already authenticates. |
| F-15 | Low | No notification to staff when their password/TOTP changes or a new login happens (ASVS 2.2.3). | Telegram/e-mail notice via the alerts bot to the staff member (needs a staff contact channel). |
| F-16 | Low | `IntegrationLog` (and `NotFoundLog` beyond its prune) grows without retention; rows may hold provider error texts. | Daily prune (e.g. 90 days, keep `ok=false` 180 days). **Fixed** — IntegrationLog pruned by `retention.prune` (90 d, failures 180 d). |
| F-17 | Info | `'unsafe-eval'` is allowed on `/kirish` and `/kabinet/sozlamalar` because the Telegram widget is believed to compile `data-onauth`; not verifiable here (telegram.org blocked). | On staging, remove `'unsafe-eval'` from that Caddy policy and test a Telegram login; keep it off if login works. |

Related operational findings (not ASVS, from the k6 smoke — loadtest/README.md): product/category
pages render per request (`no-store`), one storefront process ≈ 15–20 pages/s; one API process
≈ 15 checkouts/s on 4 vCPU; on-demand revalidation reaches one of several web replicas; the admin image build was missing
the `S3_PUBLIC_URL` build arg (admin CSP then allowed only the default `cdn.forest.uz`) — fixed in
`infra/compose.yml` and `compose.prod.yml`.
