# @forest/web — storefront

Next.js 15 App Router + next-intl 4 (`/uz`, `/ru`), Tailwind v4 tokens from `@forest/ui`.
Server components by default; client code only in interactive islands.

## Layout

- `src/app/[locale]/layout.tsx` — `<html>`, providers (`NextIntlClientProvider` with all
  namespaces except `meta`/`errors`, `ToastProvider`, `CartProvider`), skip link, `ConsentBanner`,
  `OfflineBanner`.
- `(shop)/layout.tsx` → `ShopChrome` (`src/components/layout/shop-chrome.tsx`): delivery top bar →
  `Header` → `<main id="main">` → `Footer`, plus `FloatingActions` (desktop "Savol bormi?"
  Telegram button, mobile Telegram + cart bar) and `LeadPopup` (exit intent). All storefront pages.
- `(flow)/layout.tsx` — bare `<main>` for checkout, login and `/fake-pay` (design: Checkout,
  Kirish draw their own minimal headers).
- Pages with their own compact **mobile** header inside the shop frame (cart) render
  `<MobileFlowMarker />`; CSS (`globals.css`, `:has()`) then hides `[data-chrome-mobile]` below `lg`.
- `/t/<token>` (SMS tracking link) is locale-less: the middleware rewrites it to
  `/{locale}/t/<token>` (cookie `fr_locale` → the order's language → Accept-Language → uz).
- 404: `notFoundWithRedirect(path)` (`src/lib/not-found.ts`) looks up `/seo/redirect` first and
  logs misses to `/seo/not-found`; `(shop)/[...rest]` catches unknown URLs. Error boundaries:
  `error.tsx` → `ErrorPanel`.

New pages just render their content; use the container
`mx-auto max-w-[1440px] px-3 lg:px-6` like the existing pages.

- Routes / slugs live in `src/config/site.ts` (`routes.*`, `pageReady` hides links to pages that
  don't exist yet — flip `inspiration`/`brand` when Ilhom/Brend ship).
- `quietRoutes` (cart, checkout, order, login, account, tracking) hide the lead popup and the
  mobile cart bar. Product pages (`/p/`) render their own mobile buy bar.
- Use `Link`/`useRouter`/`usePathname` from `@/i18n/navigation` (locale-aware, paths without locale).

## Data

- **Server**: `apiGet<T>(path, locale, { revalidate, tags, personal })` in `src/lib/api.ts`
  (hits `API_INTERNAL_URL/v1`). Pass `personal: true` when the response depends on the visitor:
  it forwards the incoming `Cookie` header and disables caching (route becomes dynamic).
  `apiGetOptional` returns `null` instead of throwing — for optional blocks only.
  Shared loaders (request-deduplicated): `getSettings`, `getCategories`, `getHomeContent` in
  `src/lib/data.ts`.
- **Browser**: `clientApi` in `src/lib/client-api.ts` — same-origin `/api/*` rewrite, so
  `fr_session`/`fr_cart` stay first-party. Sends the page locale as `Accept-Language`.
  Throws `ClientApiError { status, code, message, field }` (`code === 'NETWORK'` offline).
  Add new endpoints there, typed with `@forest/contracts` DTOs.

## Customer & flow helpers

- `getMe(locale)` / `getMyAddresses(locale)` (`src/lib/customer.ts`): signed-in customer or null.
- Login: `useAfterLogin(next)` (`components/auth/use-after-login.ts`) is the single post-login
  step for SMS code and Telegram (favourites merge → cart refresh → `next` → `router.refresh()`,
  which lets the middleware set `fr_ident`); `useAuthErrorMessage()` maps `ClientApiError`s.
- Telegram Login Widget: `<TelegramLogin bot mode="login|link" onSuccess />`
  (`components/auth/telegram-login.tsx`, script helper `lib/telegram-widget.ts`). Render it only
  when `settings.auth.telegramBot` is set (it is `null` until the Telegram integration is
  connected — dev has none). It injects `telegram-widget.js?22` on idle or on the first
  pointer/focus, uses `data-onauth` (never redirect mode), and is used only on `/kirish` and
  Kabinet → Sozlamalar (`TelegramLink`). Never import it into shared chrome.
- Telegram-only customers have `me.phone === null` (cabinet shows `@username`, checkout asks for
  a phone); never format `me.phone` without a null check.
- Carrier details (`components/order/carrier-parts.tsx`, helpers in `lib/carrier.ts`):
  `CourierCard` (call link only for an unmasked number, `tel:<phone>,<ext>`), `CarrierHistory`,
  `BranchCard` (BTS branch = latest `AT_BRANCH` history `place`). Tracking renders them from
  `TrackingDto`; the order page loads `/track/<token>` only when `deliveryStatus` is carrier-side.
- Favourites: `useFavourite(productId)` (`src/lib/favourites.ts`) — localStorage for guests,
  `/me/favorites` for identified visitors; `mergeLocalFavourites()` runs after OTP login.
- Delivery quote: `useDeliveryQuote(region, district, revision, pin?)` (checkout passes the
  geolocation pin; `/cart?zone=&lat=&lng=` prices the totals the same way) + `optionEta` (`components/cart/use-quote.ts`);
  the cart's region is kept in `sessionStorage` (`fr_region`) and preselected on checkout.
- Checkout sends `Idempotency-Key` (uuid kept while the payload is unchanged, so retries reuse it).
- Money inside translated sentences: `soum(amount, locale)` from `src/lib/format.ts` (NBSP); in
  JSX use `<Price />`. Dates: `formatWhen(tc, iso)` → "Bugun, 18:15" (Asia/Tashkent).
- Server-rendered action buttons use `useHydrated()` (`src/lib/use-hydrated.ts`) and stay disabled
  until hydration, so early taps (and e2e clicks) are never lost.
- `/fake-pay` exists only while the API runs fake providers: it probes `POST /dev/fake-pay` with an
  unknown order (ORDER_NOT_FOUND = fake mode, NOT_FOUND = off → 404) and ignores the `return` query.

## Cart

`useCart()` from `@/components/cart/cart-provider`:

```ts
const { count, totalSoum, cart, status, addItems, setCart, refresh } = useCart();
await addItems([{ variantId, qty: 1, priceSoum }]); // optimistic, rolls back + toasts on error
setCart(await clientApi.cart.setQty(variantId, 2)); // any call returning CartDto
```

The header pill, mobile icon badge and mobile cart bar all read this store. Cart/checkout pages
should call `setCart` with every `CartDto` they receive so the header stays in sync.

## Conventions

- Copy: `messages/uz.json` (design copy) + `messages/ru.json`, keyed by screen. Never hardcode UI text.
  Russian strings to double-check: `messages/RU_REVIEW.md`.
- Money: `<Price soum locale />` from `@forest/ui` (NBSP separators). Never format by hand.
- Never render `[placeholder]` text or ratings without real data — hide the block instead.
- Analytics hooks: `data-track="<event>"` on actionable elements (+ `data-variant-id`,
  `data-track-list`); PII inputs carry `data-private` (`PhoneInput` already does).
- Consent: `readConsent()` / `CONSENT_EVENT` in `src/lib/consent.ts` (cookie `fr_consent`).
- `fr_ident=1` is mirrored by the middleware when `fr_session` exists (client can't read the
  httpOnly session) — use it to skip lead capture for identified visitors.
- SEO: `alternates(locale, path)` from `src/lib/seo.ts` (canonical + hreflang uz/ru/x-default),
  `<JsonLd data />` for schema.org. Filter/sort URLs are `noindex,follow` with a base canonical.
- Logos: `<Logo src={staticImport} className="h-5" />` (`src/components/ui/logo.tsx`).
  Product/stock photos always come from the API (S3).
- Bottom sheets: `Sheet` (`src/components/ui/sheet.tsx`, Radix Dialog). Toasts: `useToast()`.

## Tests

- `pnpm --filter @forest/web test` — Vitest + Testing Library (jsdom) for client islands and pure
  helpers (`src/**/*.test.ts(x)`; mock `@/i18n/navigation`, cart provider and `clientApi`).
- Server-rendered states (Telegram-only customer, courier/BTS tracking) are e2e-tested through the
  dev-only API (`POST /api/dev/telegram-login`, `POST /api/dev/shipment`), not route interception:
  RSC fetches happen on the Next server. See `e2e/tests/phase2.spec.ts`.

## Performance rules (Lighthouse mobile ≥ 90, see CLAUDE.md §6)

- Chrome/secondary links (header, footer, legal, breadcrumbs, locale switch) take `prefetch={false}`;
  keep default prefetch only on the primary browse path (CTAs, category chips, product cards).
- No storage/cookie reads in mount effects; use `onIdle(fn)` (`src/lib/idle.ts`) or read on demand.
- Interaction-only UI (dialogs, sheets, popups, consent panel) loads via `next/dynamic` when needed.
- Don't add `app/[locale]/not-found.tsx` (its tree ships in every page's RSC payload) and don't
  preload the web font. CSS is inlined (`experimental.inlineCss`); messages are precompiled.
