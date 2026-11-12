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

1. **Lead popup on mobile is an intrusive interstitial** (`components/lead/lead-popup.tsx`): a
   full-screen blurred modal after 40 s or on a "fast scroll-up" (≥ 60 % of the viewport in
   400 ms) — an ordinary flick back to the header triggers it, also mid-product page. Google
   demotes pages with such popups on mobile. Suggest on phones: a slim non-modal bottom bar, never
   on `/p/*`, cart or checkout, and drop the scroll-up trigger. Marketing decision → not changed.
2. **Consent banner takes ~260 of 740 px (35 %) at 360 px** on first visit, covering the hero. A
   shorter text and one button row (or a compact bar with "Sozlash" opening the panel) would halve
   it. Copy/legal decision (open question 85) → not changed.
3. **Product page perf**: LCP is dominated by render delay (hydration), not the image. Cheapest
   next steps: lazy-hydrate below-the-fold islands (calculator, reviews, "complete the set"),
   and measure on the real VPS/CDN before tuning further — this machine's noise (±5 points) is
   larger than the remaining 89 → 90 gap reported earlier.
4. **Contrast**: `text-subtle` (#8D9586) is 3.1:1 on white / 2.7:1 on canvas — used for the old
   (struck) price in `Price`, the future steps of the tracking timeline and all placeholders.
   WCAG AA needs 4.5:1 → use `text-muted` (#5E6459, 5.3–6.1:1). Design-token decision.
5. **Remaining sub-44 px targets** (all ≥ 24 px, so WCAG 2.2 AA 2.5.8 passes; 44 px is
   AAA/Apple HIG): `Chip` (36 px — cabinet order filters, search category chips), qty stepper
   buttons 36×48 (as designed), calculator presets 32 px, filter volume chips 38 px, consent banner
   buttons (`size="sm"`, 36 px), product-card title links, footer legal links.
6. **Buy bar with a total ≥ 10 000 000 so'm at 360 px** would still crowd the stepper (needs qty ×
   price that large; not realistic for current prices).
7. Partner logos use `sizes="200px"` at 45–110 px rendered width; sources are ≤ 768 px and ≤ 7 KB,
   so the waste is negligible — leave.
8. Checkout delivery cards at 360 px: the Yandex logo chip takes ~135 px and wraps the carrier
   name to 2–3 lines in RU; stacking the logo above the text below 375 px would read better.

## Not verified

Real devices (iOS Safari focus zoom and `env(safe-area-inset-*)` — headless Chromium reports 0
insets, so the padding was checked by CSS reasoning and by confirming nothing changes when the
inset is 0), Telegram in-app browser, real 3G latency, Lighthouse through Caddy/CDN with real S3
images, Lighthouse on catalog/product in RU, keyboard-open screenshots on Android/iOS.
