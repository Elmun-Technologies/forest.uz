# 01 · Product requirements (PRD)

## 1. Product
**Forest** — premium European paints sold online in Uzbekistan:
- chalk-type furniture paint that renews/whitens old furniture (dresser, wardrobe, table, kitchen fronts);
- fabric spray paint that recolors sofas and armchairs;
- fabric cleaner, protective wax, brushes, rollers;
- ready **kits** (furniture kit, sofa kit) — the main conversion driver.

Positioning (copy on Home): *"Eski mebel yangidek bir kunda"* — renew old furniture in one day, without a master, several times cheaper than buying new.

Phase 1: single seller (Forest). Phase 2: **marketplace** (other brands/sellers). Every product/order model must be marketplace-ready from day one (see business rules).

## 2. Goals & KPIs
| Goal | KPI | Target (initial, to be calibrated) |
|---|---|---|
| Capture every visitor | Lead capture rate (phone left) | ≥ 6 % of sessions |
| Convert | Session → order CR | ≥ 2.5 % (sample data shows 2.8 %) |
| Fast delivery promise | Orders delivered within SLA (12 h Tashkent / 24 h regions) | ≥ 95 % |
| Own the data | 100 % of sessions, events, orders and customers in our DB; no dependency on GA/Metrika for analytics | – |
| Retention | Repeat purchase within 90 days | ≥ 15 % |
| Performance | Lighthouse mobile | ≥ 90 on Home, Catalog, Product |

## 3. Users
- **Shopper (B2C)** — mostly mobile, comes from Instagram/Telegram/TikTok ads, Google/Yandex search. UZ (Latin) primary, RU secondary.
- **Owner** — Elmurodov; full access.
- **Manager, Operator, Warehouse, Marketer** — staff roles (see RBAC in business rules).
- **Seller (v2)** — marketplace vendor.

## 4. Languages
- UZ (Latin) default, RU. Locale in URL prefix: `/uz/...`, `/ru/...`; `/` redirects by `Accept-Language` → cookie → default `uz`.
- All content entities (products, categories, pages, SEO meta, bot templates, emails/SMS) have UZ + RU fields.
- Copy in design files is final UZ copy unless in `[brackets]`. RU copy must be written (professional, not machine-literal) — create `messages/ru.json`; flag strings that need owner review.

## 5. Storefront pages (MVP unless marked)

Each page: see screenshot in `design/screens/` + source in `design/source/`.

### 01 Home (`Main`, `Mobil-Bosh`)
- Hero: positioning, rating badge (from real reviews), 2 CTAs: "Buyumimga bo'yoq tanlash" (opens quick selector) and "Narxlar" (catalog).
- **Before/after slider** (drag range) with "shop this result" kit card.
- Trust chips: 12 h delivery, 14-day return, water-based/odorless, made in Europe.
- **Quick selector** ("1 daqiqada tanlang"): user picks an item (sofa, armchair, dresser, wardrobe, table, kitchen) → shows recommended kit, quantity, area, time, "buy new vs Forest" price comparison, add-kit-to-cart. Analytics showed selector users convert ×3 → it must be first-class and tracked (`selector_used`, `selector_result`, `selector_add_to_cart`).
- Customer results gallery (admin-managed, from approved review photos).
- Reviews summary (rating distribution from verified purchases).
- Bestsellers (admin-selected).
- How it works: 3 steps + video guide.
- FAQ (admin-managed, FAQPage schema).
- Delivery & payment block with Yandex/BTS and Payme/Click logos.
- Lead capture: −10 % first order code for phone (SMS) or Telegram bot.
- Floating Telegram help button.

### 02 Catalog (`Katalog`, `Mobil-Katalog`)
- Category capsules (Mebel uchun, Mato uchun, Aksessuarlar, To'plamlar).
- Filters: surface type, color, volume, price, brand (brand/seller filter ready for marketplace). Mobile: bottom sheet.
- Sort: popular, new, price asc/desc. Pagination or "load more" with crawlable `?page=`.
- Promo card (kit) inside grid. SEO text block at bottom (admin-editable per category & locale).
- Quick add to cart from card (mobile shows cart counter + sum bar).

### 03 Product (`Mahsulot`, `Mobil-Mahsulot`)
- Gallery + video, badges (Xit, Yangi, −10 %).
- Variant pickers (volume / color) with price per variant; quantity.
- Stock line: "Omborda bor · N dona qoldi" (low-stock only when < threshold); **delivery countdown**: "Hozir buyurtma bersangiz, Toshkentda bugun HH:MM gacha yetkaziladi" computed from delivery settings (cut-off).
- Add to cart, Buy now; sticky buy bar on scroll (desktop & mobile).
- Delivery & payment rows (prices from settings), key specs (coverage m²/L, drying time, water-based, made in EU + certificate).
- Tabs: description, specs, how to apply, delivery.
- **Paint calculator**: preset items (tumba 1.5 m², komod 3, stol 2.5, shkaf 8) or custom m², coats → liters → recommended variant(s) → add recommendation to cart.
- Seller block ("Forest · rasmiy sotuvchi") — marketplace-ready.
- Reviews (verified only, photos), "bought together" (cross-sell), out-of-stock state → "Tez orada" + waitlist (Telegram/SMS notify) + in-stock alternative.

### 04 Cart (`Savat`, `Mobil-Savat`)
- Qty change, remove, free-delivery progress bar ("Yana X so'm — yetkazish bepul"), promo code input with inline validation messages, upsell (e.g. cleaner for fabric spray: "Tozalovchisiz rang notekis chiqadi"), delivery ETA line.
- Cart persists: anonymous cart by cookie id; merges into customer cart on login/phone identification.

### 05 Checkout (`Checkout`, `Mobil-Checkout`) — single page, 3 steps
1. Contact: name, phone (+998 mask, 9 digits validation). Phone = identity (auto-creates customer; no password).
2. Delivery: region → district → address (+ map pin on mobile via Google Maps autocomplete). Method auto-suggested: Tashkent city → Yandex express (12 h); elsewhere → BTS (24 h, to door or branch). Price from delivery zones.
3. Payment: Payme, Click, cash/card on delivery (COD). Comment optional.
- Summary with items, discount, delivery, total. Legal consent line (offer version stored on the order). Card data never touches our servers.
- Online payment → redirect to Payme/Click checkout → return URL → order page; webhook is the source of truth.
- COD → "Operator 15 daqiqa ichida qo'ng'iroq qilib tasdiqlaydi" → order status NEW awaiting confirmation.

### 06 Order received (`Buyurtma`)
Order number, status timeline, payment status, delivery ETA, "track in Telegram" deep link (`t.me/forest_uz_bot?start=order_<token>`), guide links, cross-sell.

### 07 Account (`Kabinet`)
Orders history (+ repeat order), addresses, favorites, my reviews, notification settings (SMS/Telegram consent toggles), data download/delete request.

### 08 Inspiration (`Ilhom`) — v1.1
Before/after projects, video tutorials, color-choice articles, FAQ. Admin-managed (simple CMS: title, slug, cover, body rich text, locale, SEO).

### 09 About brand (`Brend`) — v1.1
History & values, manufacturer & certificates, partnership for craftsmen, marketplace waitlist form.

### 10 Login (`Kirish`)
Phone → 4-digit SMS code (Eskiz), resend after 60 s, rate-limited; or Telegram Login. Auto-account on checkout.

### Legal (`Huquqiy`)
Offer (oferta), privacy policy, returns, delivery & payment. Versioned; each order stores the accepted offer version. Template text is a **draft — lawyer must review**. Payme/Click merchant onboarding requires the offer page to be public.

### Tracking (`Kuzatish`) — `/t/[token]`
No login. Link sent by SMS/bot. Shows timeline, courier info/ETA (Yandex) or BTS track history + branch, order contents, payment, address, "prepare before arrival" guide video, buttons: write in bot, change address (until handed to courier).

### Edge states (`Holatlar`) — must all exist
Payment failed (order kept, stock reserved 30 min, retry other method, bot reminder after 15 min), out of stock (waitlist + alternative), empty cart (selector + recently viewed), 404 (logged → SEO center suggests 301), no search results (synonyms UZ/RU/Cyrillic/typos; zero-result queries logged), form errors (human messages), offline (cart preserved).

### Global
- Header: top bar "Toshkent bo'ylab 12 soatda · O'zbekiston bo'ylab 24 soatda" (from settings), search, language switch, account, cart.
- Footer: categories, info pages, legal, contacts, payment & delivery logos, socials.
- Exit-intent popup (`Popup`): desktop on exit intent; mobile after 40 s or fast scroll-up; once per session; never for identified users; −10 % code by SMS or bot.
- Cookie/consent banner (analytics + marketing consent separately).
- Search with autocomplete (products, categories, articles).

## 6. Admin panel
Full spec: `docs/08-admin-panel.md` (A1–A16).

## 7. Telegram service bot
Spec: `docs/09-telegram-bot.md`. It is a **service** bot (lead, status, abandoned cart, advice, reviews) — not a shop inside Telegram. Sales finish on the website.

## 8. Non-functional
- Mobile-first, responsive 360–1920 px. Touch targets ≥ 44 px.
- Performance budget: LCP < 2.5 s, INP < 200 ms, CLS < 0.1 on 4G mid-range Android; JS on product page < 170 KB gz.
- Accessibility WCAG 2.1 AA (contrast, focus states, labels, keyboard nav).
- SEO: SSR/SSG for all public pages, see `docs/10-seo.md`.
- Security & privacy: `docs/14-security-and-compliance.md`.
- Availability 99.9 %; backups daily (PITR for Postgres).
- Uzbek personal-data law: citizens' personal data stored on servers located in Uzbekistan (verify with lawyer; affects hosting choice).

## 9. Out of scope for MVP (v2+)
Marketplace seller onboarding/cabinet/commissions/payouts, installment payments (Uzum Nasiya, Alif) — "soon" in integrations hub, Uzum Market feed, offline POS, B2B/craftsman pricing tiers, native mobile app.
