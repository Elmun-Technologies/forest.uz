import type { ContentBlock, DeliveryZone, SettingValue } from '@forest/contracts';
import { buildContentVars, fillBlocks, fillText } from './blocks';

const store: SettingValue<'store.info'> = {
  name: 'Forest',
  domain: 'forest.uz',
  phone: '+998998202277',
  email: 'info@forest.uz',
  hours: { uz: '9–20', ru: '9–20' },
  telegramBot: 'forest_uz_bot',
  instagram: null,
  languages: ['uz', 'ru'],
  currency: 'UZS',
  dataLocation: 'UZ',
  legal: {
    entityName: null,
    stir: '123456789',
    address: null,
    bank: null,
    mfo: null,
    account: null,
  },
  offerVersion: 'v1',
  deletionSlaDays: 30,
};
const returns = { returnDays: 14, defectReportHours: 48, refundBusinessDays: '3–10' };
const zone = (over: Partial<DeliveryZone>): DeliveryZone => ({
  key: 'z',
  name: { uz: 'z', ru: 'z' },
  carrier: 'YANDEX',
  regions: [],
  priceSoum: 1,
  freeFromSoum: null,
  etaLabel: { uz: '', ru: '' },
  rule: {
    promiseHours: 12,
    cutoff: '18:00',
    afterCutoffBy: '12:00',
    workDays: [0, 1, 2, 3, 4, 5, 6],
  },
  active: true,
  sort: 1,
  ...over,
});

describe('content variables', () => {
  it('derives phone, legal and delivery variables from settings', () => {
    const vars = buildContentVars(store, returns, [
      zone({ carrier: 'BTS', sort: 0, rule: { promiseHours: 24, workDays: [1] } }),
      zone({ active: false, rule: { promiseHours: 12, cutoff: '20:00', workDays: [1] } }),
      zone({}),
    ]);
    expect(vars['store.phoneFormatted']).toBe('+998 99 820 22 77');
    expect(vars['store.legal.stir']).toBe('123456789');
    expect(vars['store.legal.entityName']).toBeNull();
    expect(vars['delivery.cutoff']).toBe('18:00');
    expect(vars['delivery.afterCutoffBy']).toBe('12:00');
    expect(vars['returns.returnDays']).toBe(14);
  });

  it('leaves delivery variables empty without an express zone', () => {
    const vars = buildContentVars(store, returns, []);
    expect(vars['delivery.cutoff']).toBeUndefined();
  });
});

describe('fillText', () => {
  it('fills, and hides text with missing vars or bracket placeholders', () => {
    expect(fillText('{a} kun', { a: 14 })).toBe('14 kun');
    expect(fillText('{a} kun', {})).toBeNull();
    expect(fillText('{a} kun', { a: '' })).toBeNull();
    expect(fillText('Reyting [4,9]', {})).toBeNull();
    expect(fillText('Matn', {})).toBe('Matn');
  });
});

describe('fillBlocks', () => {
  const vars = { x: 'X', n: 3 };

  it('drops blocks and items whose variables are missing', () => {
    const blocks: ContentBlock[] = [
      { type: 'p', text: 'ok {x}' },
      { type: 'p', text: 'gone {missing}' },
      { type: 'note', tone: 'warn', text: '{missing}' },
      { type: 'list', ordered: true, items: ['a {n}', 'b {missing}'] },
      { type: 'list', ordered: false, items: ['{missing}'] },
      {
        type: 'dl',
        items: [
          { term: 'T', desc: '{x}' },
          { term: 'T2', desc: '{missing}' },
        ],
      },
      { type: 'dl', items: [{ term: '{missing}', desc: 'd' }] },
      {
        type: 'faq',
        items: [
          { q: 'Q?', a: '{n} kun' },
          { q: 'Q2?', a: '[muddat]' },
        ],
      },
      {
        type: 'table',
        head: ['A', 'B'],
        rows: [
          ['1', '{x}'],
          ['2', '{missing}'],
        ],
      },
      { type: 'table', head: ['{missing}'], rows: [['1']] },
      { type: 'table', head: ['A'], rows: [['{missing}']] },
    ];
    expect(fillBlocks(blocks, vars)).toEqual([
      { type: 'p', text: 'ok X' },
      { type: 'list', ordered: true, items: ['a 3'] },
      { type: 'dl', items: [{ term: 'T', desc: 'X' }] },
      { type: 'faq', items: [{ q: 'Q?', a: '3 kun' }] },
      { type: 'table', head: ['A', 'B'], rows: [['1', 'X']] },
    ]);
  });

  it('removes headings left without content, including nested ones', () => {
    const blocks: ContentBlock[] = [
      { type: 'h2', text: 'Kept' },
      { type: 'p', text: 'body' },
      { type: 'h2', text: 'Empty section' },
      { type: 'h3', text: 'Empty sub' },
      { type: 'p', text: '{missing}' },
      { type: 'h2', text: 'Parent' },
      { type: 'h3', text: 'Child' },
      { type: 'p', text: 'child body' },
      { type: 'h2', text: 'Trailing' },
    ];
    expect(fillBlocks(blocks, vars).map((b) => ('text' in b ? b.text : b.type))).toEqual([
      'Kept',
      'body',
      'Parent',
      'Child',
      'child body',
    ]);
  });

  it('never leaves unresolved {var} text', () => {
    const out = JSON.stringify(fillBlocks([{ type: 'p', text: '{a}{b}' }], { a: 1 }));
    expect(out).not.toMatch(/\{\w/);
  });
});
