import { describe, expect, it } from 'vitest';
import { localeFromAcceptLanguage, t } from './locale';
import { localizedSchema } from './schemas/locale';
import { containsPlaceholder, cyrillicToLatin, normalizeSearch, slugify } from './text';

describe('locale', () => {
  it('resolves localized values with fallback', () => {
    expect(t({ uz: 'Savat', ru: 'Корзина' }, 'ru')).toBe('Корзина');
    expect(t({ uz: 'Savat', ru: '' }, 'ru')).toBe('Savat');
    expect(t({ ru: 'Корзина' }, 'uz')).toBe('Корзина');
    expect(t('plain', 'uz')).toBe('plain');
    expect(t(null, 'uz')).toBe('');
    expect(t({}, 'uz')).toBe('');
  });

  it('parses Accept-Language', () => {
    expect(localeFromAcceptLanguage('ru-RU,ru;q=0.9,en;q=0.8')).toBe('ru');
    expect(localeFromAcceptLanguage('en-US,uz;q=0.5,ru;q=0.4')).toBe('uz');
    expect(localeFromAcceptLanguage('en')).toBe('uz');
    expect(localeFromAcceptLanguage(undefined)).toBe('uz');
  });

  it('validates localized json', () => {
    expect(localizedSchema.parse({ uz: 'a' })).toEqual({ uz: 'a', ru: '' });
  });
});

describe('text', () => {
  it('handles Uzbek apostrophe variants and Cyrillic', () => {
    expect(normalizeSearch("Bo'yoq")).toBe('boyoq');
    expect(normalizeSearch('Boʻyoq')).toBe('boyoq');
    expect(normalizeSearch('Bo’yoq')).toBe('boyoq');
    expect(normalizeSearch('бўёқ')).toBe('boyoq');
    expect(normalizeSearch('Краска для дивана')).toBe('kraska dlya divana');
    expect(normalizeSearch('  Mato   spreyi! ')).toBe('mato spreyi');
    expect(normalizeSearch('Café')).toBe('cafe');
    expect(cyrillicToLatin('ҚЎҒ')).toBe("qo'g'");
  });

  it('slugifies', () => {
    expect(slugify("Chalk White mebel bo'yog'i")).toBe('chalk-white-mebel-boyogi');
    expect(slugify('Divan yangilash to’plami — Zaytun')).toBe('divan-yangilash-toplami-zaytun');
  });

  it('detects design placeholders', () => {
    expect(containsPlaceholder('[Mijoz ismi]')).toBe(true);
    expect(containsPlaceholder('Reyting [4,9]')).toBe(true);
    expect(containsPlaceholder('Real text')).toBe(false);
  });
});

describe('catalog query schema', () => {
  it('parses onSale strictly', async () => {
    const { productListQuerySchema } = await import('./schemas/catalog');
    expect(productListQuerySchema.parse({ onSale: 'false' }).onSale).toBe(false);
    expect(productListQuerySchema.parse({ onSale: 'true' }).onSale).toBe(true);
    expect(productListQuerySchema.parse({}).onSale).toBeUndefined();
  });
});

describe('telegram login payload schema', () => {
  const hash = 'a'.repeat(64);
  it('keeps every field (they are all signed) and checks the required ones', async () => {
    const { telegramAuthSchema } = await import('./schemas/commerce');
    const ok = telegramAuthSchema.safeParse({
      id: 123456789,
      first_name: 'Malika',
      username: 'malika',
      auth_date: 1761530000,
      hash,
      new_field: 'x',
    });
    expect(ok.success && ok.data.new_field).toBe('x');
    expect(telegramAuthSchema.safeParse({ id: 1, auth_date: 1, hash: 'zz' }).success).toBe(false);
    expect(telegramAuthSchema.safeParse({ id: 'abc', auth_date: 1, hash }).success).toBe(false);
    expect(telegramAuthSchema.safeParse({ id: 1, hash }).success).toBe(false);
    expect(
      telegramAuthSchema.safeParse({ id: 1, auth_date: 1, hash, 'Bad-Key': 'x' }).success,
    ).toBe(false);
  });
});
