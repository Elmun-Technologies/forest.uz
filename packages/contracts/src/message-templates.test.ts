import { describe, expect, it } from 'vitest';
import {
  MESSAGE_TEMPLATES,
  OPT_OUT_VARIABLE,
  renderTemplate,
  TEMPLATE_VARIABLES,
  templateMeta,
  templateProblems,
  templateVariables,
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

  it('marketing SMS templates must carry the {stop} opt-out slot', () => {
    expect(
      templateProblems({
        key: 'cart_abandoned_24h_sms',
        body: { uz: 'Forest: {kod} {link}', ru: 'Forest: {kod} {link} Отписка: {stop}' },
        buttons: [],
      }),
    ).toEqual([{ field: 'body.uz', code: 'missing_variable', variable: 'stop' }]);
  });

  it('custom audience templates allow {ism} {link} {stop} and need {stop}', () => {
    expect(templateMeta('custom_vip')).toMatchObject({
      kind: 'marketing',
      vars: ['ism', 'link', 'stop'],
    });
    expect(
      templateProblems({
        key: 'custom_vip',
        body: { uz: '{ism} {kod} {stop}', ru: '{ism}' },
        buttons: [],
      }),
    ).toEqual([
      { field: 'body.uz', code: 'unknown_variable', variable: 'kod' },
      { field: 'body.ru', code: 'missing_variable', variable: 'stop' },
    ]);
  });
});

describe('catalog', () => {
  it('every marketing template that can go by SMS requires the opt-out slot', () => {
    for (const [key, meta] of Object.entries(MESSAGE_TEMPLATES))
      if (meta.kind === 'marketing' && meta.channels.includes('SMS'))
        expect(meta.required, key).toContain(OPT_OUT_VARIABLE);
  });

  it('uses the A12 variables plus the BTS and opt-out slots only', () => {
    const allowed = new Set<string>([...TEMPLATE_VARIABLES, 'trek', 'filial', OPT_OUT_VARIABLE]);
    for (const [key, meta] of Object.entries(MESSAGE_TEMPLATES))
      for (const v of meta.vars) expect(allowed.has(v), `${key}:${v}`).toBe(true);
  });

  it('lists variables in order of first use', () => {
    expect(templateVariables('{a} {b} {a}')).toEqual(['a', 'b']);
  });
});
