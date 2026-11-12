# Mobile audit — storefront (`apps/web`)

Date: 2026-11-12. Scope: storefront only (no API/admin/payment changes). Goal: the client demo on
phones (UZ: mid-range Android, 3G/4G).

## How it was measured

- **Stack**: production build (`next build` + `next start`) against the real API
  (`node dist/main.js`, `PROVIDERS_MODE=fake`), local Postgres 16 + Redis 7, seed data. No Docker
  here: seed photos were served by a tiny static server on the `S3_PUBLIC_URL` path, so image
  bytes are real but there is no CDN/S3 latency.
- **Layout audit**: Playwright (Chromium, `isMobile`, touch, Android UA) at **360×740 (DPR 2),
  390×844 (DPR 3), 412×915 (DPR 2.625)**, **UZ and RU** — 19 views each: home (first visit with
  consent banner + returning), catalog, category, filters sheet, kit + paint product, search,
  brand, delivery info, login, OTP step, cart, checkout, a real COD order → order page →
  tracking `/t/<token>` → OTP login → cabinet, addresses, settings (114 page loads per run). Per
  page: layout-viewport widening / horizontal overflow, interactive elements < 44×44 px,
  `input/select/textarea` font-size < 16 px, `<img sizes>` slot vs rendered width, CLS
  (`layout-shift` observer) and the LCP element; full-page screenshots reviewed by eye.
- **Lighthouse 12.8** (mobile default config: Moto G Power emulation, simulated Slow 4G), 5 runs per
  page after a warm-up run (`/_next/image` cache warm), median. The machine is shared with other
  sessions, so run-to-run spread is large (single runs on home: 80–96).
- **Bundle**: `next build` route table (first-load JS).

## Results

| Check | Before | After |
|---|---|---|
| Pages whose layout viewport widened (page zoomed out) | 4 (search, 360 + 390, UZ + RU: 411/402 px wide) | 0 |
| Form controls with text < 16 px (iOS focus zoom) | 120 occurrences (checkout, cart promo/region, catalog search/sort, filters, cabinet, 404) | 0 |
| Mobile buy bar at 360 px | price ran under the qty stepper (`189 000 so'm` clipped) | fits; currency word dropped only when the column is < 152 px |
| Sticky bars vs iPhone home indicator / Android gesture bar | no `viewport-fit`, no insets | `viewport-fit=cover` + `env(safe-area-inset-*)` |
| CLS (in-browser, all 114 loads) | 0 – 0.007 | unchanged |

Lighthouse mobile, median of 5 (same machine, before → after):

| Page | Score | LCP | TBT |
|---|---|---|---|
| Home `/uz` | 93 → 89 | 2.57 s → 2.52 s | 227 → 309 ms |
| Catalog `/uz/katalog` | 92 → 89 | 2.91 s → 2.94 s | 162 → 328 ms |
| Product `/uz/p/chalk-white` | 94 → 92 | 2.85 s → 2.78 s | 87 → 196 ms |

No JavaScript changed (first-load sizes identical), yet TBT moved by +100–170 ms: the deltas are
machine noise, not the changes. `observedFirstContentfulPaint` was 170–370 ms in every run (no
paint-holding stall, CLAUDE.md §17). Product LCP breakdown (simulated): TTFB ≈ 0.46 s, load delay
0.4–1.0 s, load time < 0.3 s, **render delay 1.4–1.9 s** — the LCP image is already preloaded and
fetched at High priority; the remaining cost is main-thread/hydration, not the image.

First-load JS (unchanged by this work): shared 102 KB · home 146 · catalog 158 · product 151 ·
cart 155 · checkout 146 · login 140 · tracking 141 · order 137 · cabinet 144 KB — all under the
170 KB budget.

**Tried and reverted**: `fetchPriority="high"` on the home hero and the mobile product LCP image
(Next 15's `priority` preloads without a fetch priority). A/B on home, 9 runs each: with it median
87 / LCP 3.03 s, without 89 / 2.58 s; product 94 / 2.86 s vs 94 / 2.85 s. No gain → not kept.

## Fixed (low-risk CSS/markup/attributes)

- **Search page widened the mobile layout** — the input wrapper had no `min-w-0`, so "Qidirish"
  pushed the page to 411 px and phones rendered the whole page zoomed out.
  `app/[locale]/(shop)/qidiruv/page.tsx`.
- **Mobile buy bar overflow at 360 px** — price column is now `flex-1 min-w-0` and a size
  container; the currency word hides below 9.5 rem (new optional `currencyClassName` on `Price`,
  `packages/ui/src/components/price.tsx`, unit-tested). `components/product/purchase.tsx`.
- **Safe areas** — `viewportFit: 'cover'` (`app/[locale]/layout.tsx`), side insets on `body`
  (`globals.css`), bottom inset added to: mobile cart/Telegram bar (`layout/floating-actions.tsx`),
  product buy bar, cart and checkout sticky CTA bars, bottom sheet footer (`ui/sheet.tsx`),
  consent banner, lead popup, toasts, mobile menu, and the matching bottom spacers
  (`layout/shop-chrome.tsx`, product page).
- **No iOS focus zoom** — shared `inputClasses` and `PhoneInput` prefix are 16 px below `lg`
  (15 px from `lg`, unchanged on desktop/admin) (`packages/ui/src/components/field.tsx`,
  `phone-input.tsx`); same for catalog search, price-range inputs, cart promo + region select,
  404 search, search page, and the invisible sort `<select>`.
- **Touch targets (44 px)** without visual change, via a padded/negative-margin or pseudo-element
  hit area: product gallery dots (were 8×8), product and FAQ accordions (were 23 px tall),
  product-card quick-add (+) (36 → 44 hit area), filter colour swatches, cart "remove" link, login
  "change number"; filter/sort triggers 40 → 44 px, filter checkbox rows 28 → 44 px on mobile,
  sheet "clear" button.

Verified after the fixes: web typecheck, lint, unit tests, ui tests, prettier; Playwright e2e
(mobile 390 project, prod build) `catalog-product`, `smoke` (storefront part), `checkout-flow`,
`pages`, `phase2` — 25 passed (the admin smoke test needs the admin app, not run here).

## Fixed in the second pass (owner-delegated decisions, same day)

Same stack and method as above (prod build, real API, local Postgres/Redis, Playwright with an
Android UA at 360/390/412 px, UZ + RU; Lighthouse 12.8 mobile, warm-up + 5 runs, median).

- **Lead popup → slim bottom bar on phones** (was recommendation 1; decision in CLAUDE.md §6,
  2026-11-12). Below `lg`: after 40 s a non-modal 52 px bar (`components/lead/lead-bar.tsx`,
  "Birinchi buyurtmaga −10% promokod" · "Olish" · ×) sits 80 px above the bottom edge, i.e. above
  the cart/Telegram bar (whose buttons end 70 px up), with the safe-area inset added. Never on
  `/p/*` (buy bar), cart, checkout, order, tracking, login or cabinet; "Olish" opens the existing
  form, × hides it for the session. The fast scroll-up trigger is gone; desktop keeps the
  exit-intent popup. Measured at 360/390/412 × UZ/RU: bar 52 px tall, clear of the floating
  buttons, no modal/overlay until "Olish", the page under it stays clickable; on a product page
  nothing appears after 80 s. Rules: `lib/lead-prompt.ts` (unit tests) + a component test.
- **Consent banner compact on phones** (was recommendation 2). Same text and choices (q.85 still
  open): heading visually hidden (still the region's label), 12 px text, one row of two 44 px
  buttons, "Sozlash" as a link next to the privacy link (still opens the settings panel).
  Height at 360×740: **~260 px (35 %) → 126 px (17 %) UZ / 142 px (19 %) RU**; 390×844: 126 / 142;
  412×915: 126 / 142. Desktop banner unchanged (440 px card, heading, three 36 px buttons).
- **Contrast** (was recommendation 4): `subtle` **#8D9586 → #676E62** — 3.1 → **5.3:1** on white,
  2.7 → **4.6:1** on canvas (`muted` #5E6459 stays darker: 6.1 / 5.3:1). Usages on dark surfaces
  (admin sidebar search, admin tag input, 404 search, desktop cart promo field) moved to
  `on-dark-subtle` (#A9B39E, 7.0:1 on `dark-2`), so none lost contrast. `packages/ui` test checks
  tokens.ts = theme.css and ≥ 4.5:1 for every text token.
- **Touch targets** (part of recommendation 5): new `hit-44` utility (invisible centred
  ::before, ≥ 44 × 44 px below `lg`, no visual change) on `Chip`, search category/suggestion
  chips, calculator presets and filter volume chips; consent buttons are now 44 px tall on phones.
  Measured hit heights at 360 px: filter volume chips 38 → 44, search chips 36 → 44, consent
  buttons 36 → 44, calculator presets 32 → 44 (lower row) / 38 (upper row: the 6 px row gap is
  shared with the row below; 44 each would need a 12 px gap, a visual change).

Lighthouse mobile after the second pass (median of 5): home **96** (LCP 2.61 s, TBT 102 ms),
catalog **93** (2.92 s, 138 ms), product **91** (2.90 s, 238 ms); CLS ≤ 0.007;
`observedFirstContentfulPaint` 99–330 ms (no paint-holding stall). Same machine noise as before:
single product runs on the unchanged code ranged 85–96 over the evening. First-load JS unchanged
(home 146, catalog 158, product 151, cart 155, checkout 146 KB — budget 170).

**Tried and reverted — deferred hydration on the product page** (was recommendation 3). Below-the-
fold islands (calculator, desktop tabs, "Birga olishadi" list, "more reviews") were wrapped so they
render only when near the viewport. (a) A Suspense boundary that suspends during hydration does
not work here: any context update above a dehydrated boundary (cart/purchase providers update
after mount) makes React discard the server HTML and show the fallback — the islands vanished.
(b) Keeping the server HTML with an empty `dangerouslySetInnerHTML` placeholder and rendering the
island on `IntersectionObserver` worked, but interleaved A/B (same build otherwise, 14 runs each):
score 93 → 94, **LCP 2.68 → 2.78 s**, TBT 220 → 125 ms — neither difference significant
(Mann–Whitney z = −1.24 LCP, 0.92 TBT), LCP (the metric that matters) did not improve, and a tap
that lands before the island renders is lost. Not kept. The observed (unthrottled) render delay is
~130 ms; the simulated 1.4–1.9 s is Lantern scaling the framework/React startup scripts (chunks
`7973` ≈ 300–440 ms, `7aab36c2` ≈ 220 ms simulated scripting), which no island-level change removes.
Re-measure on the real VPS/CDN before going further.

Verified after the second pass: web typecheck, lint, unit tests (36), ui tests (12), admin
typecheck, prettier; web production build; Playwright e2e on the prod build, `catalog-product`,
`checkout-flow`, `pages`, `phase2`, `smoke`: mobile 25 passed / 1 skipped, desktop 26 passed (the
admin smoke test needs the admin app, not run here).

## Checked and fine

Viewport meta + `theme-color`; OTP cells (`inputMode="numeric"`, `pattern`, `one-time-code` on
the first cell, paste/autofill into any cell); phone input `type="tel"` + numeric keypad +
`tel-national` + fixed `+998` prefix and `90 123 45 67` mask; checkout `autocomplete`
(name, street-address, address-level3); payment/delivery radios are real radios in labels with a
focus-visible ring; global `:focus-visible` outline; reduced-motion; no CLS from the consent
banner or popup (both are fixed-position overlays); LCP images preloaded on home/product/catalog
(`priority`), others lazy; product/card `sizes` match rendered widths; chip rows, product gallery
and the delivery table scroll inside their own containers; long RU/UZ words wrap without overflow
at 360 px; the Android keyboard (Chrome ≥ 108 resizes only the visual viewport) leaves the sticky
checkout bar behind the keyboard rather than over the fields.

## Recommendations (not done), by impact

1. **Product page perf**: deferring below-the-fold islands did not move LCP (see above). The
   remaining simulated render delay is framework/React startup; measure on the real VPS/CDN first
   (this machine's noise, ±5 points, is larger than the 89–91 → 90 gap).
2. **Remaining sub-44 px targets** (all ≥ 24 px, so WCAG 2.2 AA 2.5.8 passes; 44 px is
   AAA/Apple HIG): qty stepper buttons 36×48 (as designed), product-card title links, footer
   legal links, the inline consent links ("Maxfiylik siyosati", "Sozlash": 17 px text, 38 px hit
   area), calculator presets in the upper row (38 px, see above).
3. **Lead form copy on phones**: the form the bar opens still says "Ketishdan oldin: −10% sizga"
   ("before you leave") — fits the desktop exit intent, less so a tapped bar. Copy decision.
4. **Buy bar with a total ≥ 10 000 000 so'm at 360 px** would still crowd the stepper (needs qty ×
   price that large; not realistic for current prices).
5. Partner logos use `sizes="200px"` at 45–110 px rendered width; sources are ≤ 768 px and ≤ 7 KB,
   so the waste is negligible — leave.
6. Checkout delivery cards at 360 px: the Yandex logo chip takes ~135 px and wraps the carrier
   name to 2–3 lines in RU; stacking the logo above the text below 375 px would read better.

## Not verified

Real devices (iOS Safari focus zoom and `env(safe-area-inset-*)` — headless Chromium reports 0
insets, so the padding was checked by CSS reasoning and by confirming nothing changes when the
inset is 0), Telegram in-app browser, real 3G latency, Lighthouse through Caddy/CDN with real S3
images, Lighthouse on catalog/product in RU, keyboard-open screenshots on Android/iOS.
