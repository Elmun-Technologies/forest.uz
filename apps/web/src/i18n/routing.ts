import { defineRouting } from 'next-intl/routing';
import { DEFAULT_LOCALE, LOCALES } from '@forest/contracts';

/** `/uz/...` and `/ru/...`; `/` redirects by cookie → Accept-Language → uz (docs/01). */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
  localeCookie: { name: 'fr_locale', maxAge: 60 * 60 * 24 * 365 },
});
