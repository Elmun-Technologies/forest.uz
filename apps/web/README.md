# @forest/web — storefront

Next.js 15 App Router + next-intl 4 (`/uz`, `/ru`), Tailwind v4 tokens from `@forest/ui`.
Server components by default; client code only in interactive islands.

## Layout (`src/app/[locale]/layout.tsx`)

Every page gets: delivery top bar → `Header` → `<main id="main">` → `Footer`, plus global
islands: `FloatingActions` (desktop "Savol bormi?" Telegram button, mobile Telegram + cart bar),
`ConsentBanner`, `LeadPopup` (exit intent). Providers: `NextIntlClientProvider` (all namespaces
except `meta`/`errors`), `ToastProvider`, `CartProvider`.

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
