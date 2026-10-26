/**
 * Storefront route map (UZ slugs, docs/CLAUDE.md §8). Paths are locale-less; use them with the
 * next-intl `Link` from `@/i18n/navigation`. `ready: false` hides a link until its page exists
 * (v1.1 pages), so we never ship dead links.
 */
export const routes = {
  home: '/',
  catalog: '/katalog',
  category: (slug: string) => `/katalog/${slug}`,
  product: (slug: string) => `/p/${slug}`,
  search: '/qidiruv',
  cart: '/savat',
  checkout: '/checkout',
  account: '/kabinet',
  login: '/kirish',
  inspiration: '/ilhom',
  brand: '/brend',
  offer: '/oferta',
  privacy: '/maxfiylik',
  returns: '/qaytarish',
  deliveryPayment: '/yetkazish-tolov',
} as const;

/**
 * Pages that exist. Cart, checkout, order, tracking, login, cabinet and the four legal pages
 * shipped in Phase 1 and are always linked; Ilhom/Brend are v1.1.
 */
export const pageReady = {
  inspiration: false,
  brand: false,
} as const;

/** Category slugs used by the header nav ("Mebel uchun", "Divan uchun"). */
export const navCategories = { furniture: 'mebel-uchun', fabric: 'mato-uchun' } as const;

/** Routes where global marketing overlays (lead popup, cart bar) stay hidden. */
export const quietRoutes = [
  '/savat',
  '/checkout',
  '/buyurtma',
  '/kirish',
  '/kabinet',
  '/t/',
  '/fake-pay',
];

export function telegramUrl(bot: string, start?: string): string {
  return `https://t.me/${bot}${start ? `?start=${encodeURIComponent(start)}` : ''}`;
}
