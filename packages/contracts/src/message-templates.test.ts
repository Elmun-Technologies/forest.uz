import { describe, expect, it } from 'vitest';
import {
  MESSAGE_TEMPLATES,
  renderTemplate,
  TEMPLATE_VARIABLES,
  templateMeta,
  templateProblems,
  templateVariables,
  withSmsOptOut,
} from './message-templates';

describe('renderTemplate', () => {
  it('fills variables', () => {
    expect(
      renderTemplate('{ism}, savatingizda qoldi: {mahsulot}. Bugun {kod} kodi bilan −5%.', {
        ism: 'Dilnoza',
        mahsulot: 'Divan to‘plami',
        kod: 'SAVAT5',
      }),
    ).toBe('Dilnoza, savatingizda qoldi: Divan to‘plami. Bugun SAVAT5 kodi bilan −5%.');
  });

  it('drops a missing name with its comma and capitalises the rest', () => {
    expect(renderTemplate('{ism}, natija qanday chiqdi? Baholang:', { ism: '' })).toBe(
      'Natija qanday chiqdi? Baholang:',
    );
    expect(renderTemplate('Forest: {ism}, buyurtma {raqam} tayyor', { raqam: 'F-1' })).toBe(
      'Forest: buyurtma F-1 tayyor',
    );
  });

  it('refuses to render with any other variable missing (no holes in sent texts)', () => {
    expect(renderTemplate('Kod: {kod}', {})).toBeNull();
    expect(renderTemplate('Kod: {kod}', { kod: '' })).toBeNull();
  });

  it('adds the SMS opt-out line', () => {
    expect(withSmsOptOut('Matn', 'ru', 'https://f.uz/ru/obuna/s1x')).toBe(
      'Matn\nОтписаться: https://f.uz/ru/obuna/s1x',
    );
  });
});

describe('templateProblems', () => {
  const ok = { uz: 'Forest: buyurtma {raqam}. {link}', ru: 'Forest: заказ {raqam}. {link}' };

  it('accepts the catalog variables of the key', () => {
    expect(templateProblems({ key: 'order_created', body: ok, buttons: [] })).toEqual([]);
  });

  it('rejects variables outside the key’s set and empty texts', () => {
    expect(
      templateProblems({
        key: 'order_created',
        body: { uz: 'Kod {kod} {foo}', ru: '' },
        buttons: [],
      }),
    ).toEqual([
      { field: 'body.uz', code: 'unknown_variable', variable: 'kod' },
      { field: 'body.uz', code: 'unknown_variable', variable: 'foo' },
      { field: 'body.ru', code: 'empty' },
    ]);
  });

  it('requires {kod} in the OTP text', () => {
    expect(
      templateProblems({ key: 'otp', body: { uz: 'Kod', ru: 'Код {kod}' }, buttons: [] }),
    ).toEqual([{ field: 'body.uz', code: 'missing_variable', variable: 'kod' }]);
  });

  it('buttons open {link} or a fixed https URL', () => {
    const text = { uz: 'Ochish', ru: 'Открыть' };
    expect(
      templateProblems({
        key: 'order_created',
        body: ok,
        buttons: [
          { text, url: '{link}' },
          { text, url: 'http://example.com' },
        ],
      }),
    ).toEqual([{ field: 'buttons.1.url', code: 'button_url' }]);
    expect(
      templateProblems({
        key: 'order_created',
        body: ok,
        buttons: [{ text, url: 'https://forest.uz/katalog' }],
      }),
    ).toEqual([]);
  });

  it('custom audience templates allow {ism} and {link} only', () => {
    expect(templateMeta('custom_vip')).toMatchObject({ kind: 'marketing', vars: ['ism', 'link'] });
    expect(
      templateProblems({
        key: 'custom_vip',
        body: { uz: '{ism} {kod}', ru: '{ism}' },
        buttons: [],
      }),
    ).toEqual([{ field: 'body.uz', code: 'unknown_variable', variable: 'kod' }]);
  });
});

describe('catalog', () => {
  it('uses the A12 variables plus the BTS slots only', () => {
    const allowed = new Set<string>([...TEMPLATE_VARIABLES, 'trek', 'filial']);
    for (const [key, meta] of Object.entries(MESSAGE_TEMPLATES))
      for (const v of meta.vars) expect(allowed.has(v), `${key}:${v}`).toBe(true);
  });

  it('lists variables in order of first use', () => {
    expect(templateVariables('{a} {b} {a}')).toEqual(['a', 'b']);
  });
});
