import { z } from 'zod';

export const LOCALES = ['uz', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'uz';

export const localeSchema = z.enum(LOCALES);

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Localized text stored as JSON `{ uz, ru }`. Both keys optional at rest; uz is the source copy. */
export const localizedSchema = z.object({
  uz: z.string(),
  ru: z.string().optional().default(''),
});
export type Localized = { uz: string; ru?: string | undefined };

export const localizedRequiredSchema = z.object({ uz: z.string().min(1), ru: z.string().min(1) });

/** Resolve localized value with fallback uz → ru → ''. Accepts unknown JSON from the DB. */
export function t(value: unknown, locale: Locale): string {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value : '';
  const v = value as Record<string, unknown>;
  const primary = v[locale];
  if (typeof primary === 'string' && primary.length > 0) return primary;
  for (const key of LOCALES) {
    const candidate = v[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return '';
}

/** Picks locale from an Accept-Language header (`ru-RU,ru;q=0.9` → ru). */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', q] = part.trim().split(';q=');
      return { lang: tag.toLowerCase().slice(0, 2), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { lang } of ranked) if (isLocale(lang)) return lang;
  return DEFAULT_LOCALE;
}
