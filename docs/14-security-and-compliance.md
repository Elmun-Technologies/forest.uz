# 14 · Security, privacy, compliance

## Secrets
- Never commit secrets. `.env` git-ignored; `.env.example` with placeholders only. Integration credentials entered in admin are encrypted in DB (AES-256-GCM, key `APP_ENCRYPTION_KEY`, rotate-able with key id).
- API responses show only last 4 chars of any secret. Logs redact `authorization`, `password`, `token`, `secret`, `phone`, `card`, `address` keys.
- Use gitleaks in CI.

## AuthN/AuthZ
- Customers: phone OTP (4 digits, 5 attempts, 5-min TTL, hashed in DB, rate-limited per phone/IP), Telegram login (hash verification + auth_date freshness). Sessions server-side (Redis), httpOnly/secure/SameSite=Lax cookies, rotation on login.
- Admin: argon2id passwords, TOTP 2FA (mandatory Owner/Manager), lockout after 10 failures, 12 h sessions, IP/device shown in audit log; separate domain & cookie; optional IP allowlist.
- RBAC permission checks server-side on every endpoint (deny by default). Tests per role.

## Web security
- CSRF: SameSite cookies + CSRF token for state-changing admin requests.
- CSP (nonce-based) on web/admin; allow only needed origins (Payme/Click redirects, Google Maps, pixels after consent).
- Input validation with zod; Prisma parameterized queries; output encoding; rich text sanitized (DOMPurify server-side) for CMS.
- File uploads: type sniffing, size limits, image re-encode (strip EXIF/GPS from customer photos), private bucket + signed URLs until approved.
- Webhooks: verify auth/signature before processing, IP allowlists where providers publish them, replay protection (timestamps/ids), idempotency.
- Security headers (HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy). Dependency audit in CI.

## Privacy (Uzbekistan)
- Law of the Republic of Uzbekistan "On Personal Data" — personal data of UZ citizens must be processed/stored on servers physically in Uzbekistan (localization requirement). **Confirm with lawyer**; plan DB/API/object storage hosting in UZ.
- Consent capture per channel with timestamp and source; privacy policy versioned.
- Analytics: no PII in events; IP not stored raw; replay masks inputs and private elements; replay only with consent; retention: replays 30 d, raw events 13 m.
- Ad matching only hashed (SHA-256) phones of consented customers.
- Data subject requests: export (JSON/CSV) and deletion/anonymization within 30 days; logged.
- Payment cards never touch our servers (hosted checkout of Payme/Click).

## Ops
- Daily encrypted Postgres backups + WAL/PITR, offsite copy (also within UZ if PII), monthly restore drill.
- Principle of least privilege for DB users (app vs migrations vs read-only analytics).
- Audit log immutable (no update/delete permissions for app role).
