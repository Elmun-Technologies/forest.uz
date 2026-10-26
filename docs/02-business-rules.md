# 02 · Business rules

All numeric values below are **defaults stored in settings** (admin A16), never constants in code. Values marked `[confirm]` need owner confirmation (see `13-open-questions.md`).

## Money & numbers
- Currency UZS ("so'm"). Store money as **integer tiyin** (`BigInt`, 1 so'm = 100 tiyin) — Payme works in tiyin. Display: `329 000 so'm` (space thousands separator, no decimals).
- Phones stored E.164: `+998XXXXXXXXX`. UI mask `+998 90 123 45 67`; validation: exactly 9 digits after +998, valid operator codes.
- Times stored UTC, displayed `Asia/Tashkent` (UTC+5, no DST).

## Catalog
- Product → Variants (volume or color). Variant has: SKU, **IKPU (MXIK) code** (mandatory, for fiscal receipt), package code, VAT %, price, compare-at price, barcode, weight/dimensions (for delivery quote), stock (from MoySklad).
- Kits = products of type `BUNDLE` with component variants; kit stock = min of component stock; kit price set manually (−10–11 % vs components).
- Product has `sellerId` (Forest by default) — marketplace readiness.
- Low-stock threshold per variant (default 10) → "N dona qoldi" on product page + admin alert.
- Out of stock → product stays indexable, shows "Tez orada" + waitlist; can't be added to cart.

## Pricing & stock source of truth
- **MoySklad** is master for: price, stock, SKU, IKPU, product existence.
- **Site** is master for: descriptions (UZ/RU), images, SEO, badges, bestseller flags, related products.
- Conflict rule: price/stock → MoySklad wins; content → site wins.
- Stock shown = MoySklad available − our open reservations.

## Cart & reservations
- Anonymous cart by first-party cookie; merges on identification (phone/login).
- Stock is **reserved at order creation**.
  - Online payment (Payme/Click): reservation 30 min; if unpaid → payment status `EXPIRED`, reservation released, order `CANCELLED (unpaid)`; customer reminded via bot/SMS at 15 min.
  - COD: reserved until operator confirms or cancels (auto-cancel after 24 h unconfirmed `[confirm]`).
- Price fixed at order creation (snapshot item name, variant, price, IKPU on `OrderItem`).

## Delivery
| Zone | Carrier | Promise | Price | Free from |
|---|---|---|---|---|
| Tashkent city | Yandex Delivery (express) | within 12 h | `[confirm]` (or live quote from API) | 500 000 so'm `[confirm]` |
| Tashkent region | BTS | within 24 h | `[confirm]` | 500 000 `[confirm]` |
| Regional centers | BTS (door or branch) | within 24 h | `[confirm]` | 500 000 / 700 000 `[confirm]` (promo board says 700 000 for regions) |
| Districts/villages | BTS | 24–48 h | `[confirm]` | – |

- SLA clock starts at: payment confirmed (online) or operator-confirmed (COD).
- Tashkent cut-off: orders confirmed before **18:00** → same day; after → next day by **12:00**. Sunday: BTS only `[confirm]`.
- Product-page countdown and header text are computed from these settings.
- Admin A6/A7 show an SLA timer; < 1 h left → critical alert on dashboard.
- Address can be changed by customer until status `HANDED_TO_COURIER`.

## Payments
- Methods: **Payme** (Merchant API), **Click** (SHOP API), **COD** (cash or card to courier).
- Webhook/callback is the only source of truth for "paid". Return URL just shows status.
- Every payment produces a **fiscal receipt** with IKPU per item: Payme/Click fiscalize online payments (send `ikpu`, `package_code`, `vat_percent` per item in receipt detail); COD requires an online cash register/OFD solution `[confirm provider]`. Cannot launch COD legally without it.
- Max COD amount: 3 000 000 so'm `[confirm]`.
- Refunds: full or partial from admin (Payme `CancelTransaction` / Click reversal; COD → manual record). Only Owner/Manager.
- Card data never stored or logged.

## Order lifecycle
Order status (fulfilment): `NEW → CONFIRMED → PACKING → READY → HANDED_TO_COURIER → DELIVERED → COMPLETED`; side exits: `CANCELLED`, `RETURN_REQUESTED → RETURNED`.
Payment status (separate): `PENDING → PAID | FAILED | EXPIRED | REFUNDED | PARTIALLY_REFUNDED`; COD: `COD_PENDING → PAID` when courier settles.
Delivery status (separate, from carrier): `CREATED → COURIER_ASSIGNED → PICKED_UP → IN_TRANSIT → AT_BRANCH → DELIVERED | FAILED | RETURNED`.
- Public order number: `F-` + 5+ digit sequence (e.g. `F-10482`). (Design shows both `FR-240913` and `#F-10482` — use `F-xxxxx`.)
- Tracking link: `/t/{random 10-char token}` (not guessable, no PII in URL).
- Every status change: timestamp, actor (staff/system/carrier), written to `OrderEvent`; triggers notifications (bot → SMS fallback).
- Marketplace: order → `Shipment` per seller (v1 always one shipment).

## Promo codes & promotions (A14)
- Types: percent, fixed amount, free shipping, gift product.
- Fields: code, type, value, min cart, audience (all / first order / segment), usage limit total, per-customer limit, start/end, UTM source (for attribution), active flag.
- Rules (enforced server-side):
  - Codes **don't stack** with other codes or with kit/bundle discount (best one applies; tell the user).
  - **Margin guard**: total discount ≤ 15 % of cart `[confirm]`.
  - One phone **and** one device fingerprint → one use for first-order codes; suspicious usage flagged ("Shubhali").
- Canonical codes: `SALOM10` (first order −10 %, lead popup/bot), `SAVAT5` (abandoned cart −5 %, 24 h), `RAHMAT5` (review with photo −5 % next order). Design also shows `FOREST10` in popup/old screens → unify to `SALOM10`.
- Automatic promotions (no code): free delivery threshold, kit price, 2nd-purchase gift (off by default).

## Reviews & UGC (A15)
- Only **verified purchasers** can review (link from bot/email/cabinet after `DELIVERED`).
- States: `PENDING → APPROVED | REJECTED`. Only approved reviews are public and counted in rating/schema.
- Photos published only with explicit consent flag; can be added to "Results" gallery (ordered manually, before/after pairs).
- Rating ≤ 3★ → immediate alert to admin Telegram group + operator task; reply publicly allowed.
- Never fabricate or seed fake reviews; placeholders like `[4,9]` must render real aggregates or hide the block when there are none.

## Customers & consent
- Customer identity = phone. Anonymous visitor (`anonymousId` cookie) is linked to customer on: lead form, login, checkout, bot phone share.
- Consents stored per channel with timestamp & source: `sms_marketing`, `telegram`, `ads_matching` (hashed phone to ad platforms), `analytics_cookies`. Service messages (order status) don't need marketing consent.
- Messaging caps: max 1 marketing message per customer per day across channels; every marketing message has opt-out.
- Data export & delete on request within 30 days (A5 buttons).

## Staff roles (RBAC, A16)
| Permission | Owner | Manager | Operator | Warehouse | Marketer |
|---|---|---|---|---|---|
| View/edit orders | ✓ | ✓ | ✓ | ✓ | – |
| Cancel / refund | ✓ | ✓ | – | – | – |
| Customer phone & address | ✓ | ✓ | ✓ | partial (address on packing slip only) | – |
| Export customer database | ✓ | – | – | – | – |
| Product content, images, SEO | ✓ | ✓ | – | – | ✓ |
| Promo codes | ✓ | ✓ | – | – | ✓ |
| Analytics & heatmaps | ✓ | ✓ | – | – | ✓ |
| Integration keys | ✓ | – | – | – | – |
- 2FA (TOTP) mandatory for Owner & Manager, recommended for others.
- Every admin mutation → `AuditLog` (who, what, before/after, IP).
- PII masked in lists (`+998 90 *** ** 67`); full value on detail view for permitted roles, access logged.

## Telegram bot rules
See `09-telegram-bot.md`. Working hours Mon–Sat 09:00–21:00 (operator), auto-reply outside. SMS fallback via Eskiz when customer has no Telegram.

## Marketplace readiness (build now, enable in v2)
- `Seller` entity; Forest is seller #1. `Product.sellerId`, `Shipment.sellerId`, commission fields nullable.
- Catalog filter by brand/seller; product page seller block; seller rating placeholder.

## Legal
- Offer, privacy, returns, delivery pages are versioned; order stores `offerVersion`.
- 14-day return for unopened packaging `[confirm exact terms]`.
- All legal text in `[brackets]` = company data to fill; **lawyer review mandatory** before launch.
