# 04 · Data model

Draft schema: `prisma/schema.prisma` (validated with Prisma 5.22). Move it to `packages/db/prisma/schema.prisma`.

## Conventions
- IDs: `cuid()` for business entities; analytics `Event.id` / `Session.id` = UUID v7 generated client-side (time-ordered, doubles as ad-platform `event_id` for dedupe).
- Human-facing numbers: `Order.number` = `F-` + sequence (Postgres sequence starting 10001), `Customer.publicId` = `C-` + sequence.
- Money: `BigInt` tiyin, suffix `Tiyin`. Never floats. Serialize to JSON as string or number-safe integer (amounts < 2^53 so `Number()` is safe for UZS; still convert explicitly in one helper).
- Localized text: `Json` `{ "uz": "...", "ru": "..." }`, validated by zod `localized()` schema; fallback uz → ru → "".
- Timestamps: `timestamptz` (Prisma DateTime), UTC.
- Soft delete only for `Customer` (erasure keeps order records but anonymizes PII: name → "O'chirilgan", phone → hash).
- Table names: Prisma default (PascalCase models). Columns camelCase. Add `@@map` only if needed.

## Invariants (enforce in services + DB constraints/tests)
1. `Variant.ikpu` must be non-null before its product can be `ACTIVE` (fiscal receipts).
2. `Order.totalTiyin = subtotal − discount + shipping`; equals sum of `OrderItem` lines; checked in a DB transaction at creation.
3. One successful payment per order (`PAID`); `Payment(method, providerTxnId)` unique → idempotent webhooks.
4. Order status transitions only via `OrderStateMachine` (allowed edges in `02-business-rules.md`); every transition writes `OrderEvent`.
5. Stock never negative: reservation in a transaction with `SELECT … FOR UPDATE` on variant rows (or atomic `UPDATE … SET reserved = reserved + n WHERE stock - reserved >= n`).
6. Review allowed only if `(orderId, productId)` exists with order `DELIVERED|COMPLETED` and same customer; unique per order+product.
7. Promo redemption unique per order; per-customer and device limits checked inside the order transaction.
8. PII (`phone`, `address`, `contactPhone`) never written to logs; `IntegrationLog.payload` passes through a redactor.
9. `Integration.credentials` and `Staff.totpSecret` encrypted (AES-256-GCM, random IV, key from `APP_ENCRYPTION_KEY`); never returned by API (only last 4 chars).

## Raw-SQL migrations required (Prisma can't express)
- `Event` partitioned by month on `ts` (`PARTITION BY RANGE`), plus a job creating next month's partition; retention: raw events 13 months, aggregates forever.
- Extensions: `pg_trgm`, `unaccent` for search; trigram GIN index on product search document.
- Materialized views for reports (daily sessions/orders by channel, funnel, cohorts) refreshed by jobs.
- Sequences for `Order.number`, `Customer.publicId`.

## Seed (dev/staging)
Seed exactly the sample catalog from design (`Admin-Mahsulotlar` source):
| Product | SKU | Variants (price so'm, stock) |
|---|---|---|
| Chalk White mebel bo'yog'i (Mebel uchun, Xit) | FR-CW | 0,5 L 189 000 (22) · 1 L 329 000 (41) · 2,5 L 749 000 (6) |
| Mato bo'yog'i spreyi (Mato uchun, Yangi) | FR-FS | Antrasit, Zaytun, Bej, Kulrang — 249 000 each (38/44/31/19) |
| Mato tozalovchi sprey | FR-CL | 500 ml 149 000 (58) |
| Himoya mumi Clear | FR-WX | 250 ml 159 000 (4) · 500 ml 279 000 (5) |
| Oval 40 cho'tka (Aksessuar) | FR-BR-40 | 119 000 (64) |
| Mikrofibra valik 10 sm | FR-RL-10 | 79 000 (70) |
| Mebel yangilash to'plami (To'plam, −10 %) | FR-KIT-F | 549 000 (18) |
| Divan yangilash to'plami (To'plam, −11 %) | FR-KIT-S | 799 000 (0 → shows out-of-stock state) |
Prices are **sample** — real prices come from MoySklad. IKPU in seed = `"00000000000000000"` placeholder flagged in admin.
Also seed: categories, Forest seller, delivery zones/settings, message templates (UZ/RU), owner staff account from env, legal page drafts from `design/source/Huquqiy.dc.html`, FAQ from `Main.dc.html`.
