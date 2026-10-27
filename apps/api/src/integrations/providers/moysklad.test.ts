import { HttpClient } from '../http-client';
import {
  attributeValue,
  bundleStock,
  buildCustomerOrderBody,
  createMoyskladFetch,
  idFromHref,
  MoyskladInventoryProvider,
  moysklad429DelayMs,
  moyskladThrottleMs,
  msMinorToTiyin,
  normalizeIkpu,
  parseAssortmentRow,
  parseMoyskladError,
  parseStockCurrent,
  parseWebhookBody,
  salePriceTiyin,
  stockUnits,
} from './moysklad';

const BASE = 'https://api.moysklad.ru/api/remap/1.2';
const P1 = '5427bc76-b95f-11eb-0a80-04bb000cd583';
const V1 = '7944ef04-f831-11e5-7a69-971500188b19';
const B1 = '0a1b2c3d-1111-11ee-0a80-000000000001';
const mapping = { priceType: 'Chakana', ikpuAttribute: 'ikpu' };
const prices = (v: number) => [
  { value: 100, priceType: { name: 'Ulgurji' } },
  { value: v, priceType: { name: 'Chakana' } },
];

describe('MoySklad mapping helpers', () => {
  it('converts minor units (tiyin in a UZS account) and rounds float noise', () => {
    expect(msMinorToTiyin(32_900_000.000000004)).toBe(32_900_000n);
    expect(msMinorToTiyin(0)).toBe(0n);
    expect(msMinorToTiyin(-1)).toBeNull();
    expect(msMinorToTiyin('100')).toBeNull();
  });

  it('picks the configured price type case-insensitively', () => {
    expect(salePriceTiyin(prices(32_900_000), 'chakana')).toBe(32_900_000n);
    expect(salePriceTiyin(prices(1), 'Narx')).toBeNull();
    expect(salePriceTiyin(null, 'Chakana')).toBeNull();
  });

  it('reads custom attributes by name (string, number, directory value)', () => {
    const attrs = [
      { name: 'IKPU', value: '03208001001000000' },
      { name: 'n', value: 42.9 },
      { name: 'dir', value: { name: 'Yandex' } },
      { name: 'empty', value: '  ' },
    ];
    expect(attributeValue(attrs, 'ikpu')).toBe('03208001001000000');
    expect(attributeValue(attrs, 'n')).toBe('42');
    expect(attributeValue(attrs, 'dir')).toBe('Yandex');
    expect(attributeValue(attrs, 'empty')).toBeNull();
    expect(attributeValue(attrs, 'missing')).toBeNull();
  });

  it('accepts only 17-digit IKPU codes (spaces/dashes dropped, placeholder rejected)', () => {
    expect(normalizeIkpu('0320 8001-0010 00000')).toBe('03208001001000000');
    expect(normalizeIkpu('123')).toBeNull();
    expect(normalizeIkpu('00000000000000000')).toBeNull();
    expect(normalizeIkpu(null)).toBeNull();
  });

  it('turns quantities into whole sellable units', () => {
    expect(stockUnits(4.999999999999)).toBe(5);
    expect(stockUnits(4.5)).toBe(4);
    expect(stockUnits(-3)).toBe(0);
    expect(stockUnits(Number.NaN)).toBe(0);
  });

  it('kit stock = min over components of floor(free / qty)', () => {
    const stock = new Map([
      ['a', 10],
      ['b', 3],
    ]);
    expect(
      bundleStock(
        [
          { externalId: 'a', qty: 2 },
          { externalId: 'b', qty: 1 },
        ],
        stock,
      ),
    ).toBe(3);
    expect(bundleStock([{ externalId: 'a', qty: 3 }], stock)).toBe(3);
    expect(bundleStock([{ externalId: 'missing', qty: 1 }], stock)).toBe(0);
    expect(bundleStock([], stock)).toBe(0);
  });

  it('extracts ids from hrefs and refuses junk', () => {
    expect(idFromHref(`${BASE}/entity/product/${P1}?expand=x`)).toBe(P1);
    expect(idFromHref(`${BASE}/entity/product/metadata`)).toBeNull();
    expect(idFromHref(42)).toBeNull();
  });
});

describe('parseAssortmentRow', () => {
  const product = {
    meta: { href: `${BASE}/entity/product/${P1}`, type: 'product' },
    id: P1,
    name: 'Chalk White 1 L',
    article: 'FR-CW-1000',
    code: '00012',
    salePrices: prices(32_900_000),
    attributes: [{ name: 'ikpu', value: '03208001001000000' }],
    variantsCount: 0,
  };

  it('maps a product: SKU = article, IKPU from the attribute, price in tiyin', () => {
    expect(parseAssortmentRow(product, mapping)).toEqual({
      externalId: P1,
      type: 'product',
      parentExternalId: null,
      name: 'Chalk White 1 L',
      sku: 'FR-CW-1000',
      ikpu: '03208001001000000',
      priceTiyin: 32_900_000n,
      archived: false,
      hasVariants: false,
      label: null,
      components: [],
    });
  });

  it('maps a variant: SKU = code, price/IKPU inherited from its product when missing', () => {
    const info = new Map([[P1, { priceTiyin: 32_900_000n, ikpu: '03208001001000000' }]]);
    const v = parseAssortmentRow(
      {
        meta: { href: `${BASE}/entity/variant/${V1}`, type: 'variant' },
        id: V1,
        name: 'Chalk White (2.5 L, Oq)',
        code: 'FR-CW-2500',
        product: { meta: { href: `${BASE}/entity/product/${P1}`, type: 'product' } },
        characteristics: [
          { name: 'Hajm', value: '2.5 L' },
          { name: 'Rang', value: 'Oq' },
        ],
        salePrices: [{ value: 0, priceType: { name: 'Chakana' } }],
      },
      mapping,
      info,
    );
    expect(v).toMatchObject({
      type: 'variant',
      parentExternalId: P1,
      sku: 'FR-CW-2500',
      label: '2.5 L, Oq',
      priceTiyin: 32_900_000n,
      ikpu: '03208001001000000',
    });
  });

  it('maps bundle components and skips services and malformed rows', () => {
    const b = parseAssortmentRow(
      {
        meta: { type: 'bundle', href: `${BASE}/entity/bundle/${B1}` },
        id: B1,
        name: "Divan to'plami",
        article: 'KIT-1',
        salePrices: prices(50_000_000),
        components: {
          rows: [
            { quantity: 2, assortment: { meta: { href: `${BASE}/entity/product/${P1}` } } },
            { quantity: 1, assortment: { meta: { href: `${BASE}/entity/variant/${V1}` } } },
            { quantity: 0, assortment: { meta: { href: `${BASE}/entity/variant/${V1}` } } },
          ],
        },
      },
      mapping,
    );
    expect(b?.components).toEqual([
      { externalId: P1, qty: 2 },
      { externalId: V1, qty: 1 },
    ]);
    expect(
      parseAssortmentRow({ meta: { type: 'service' }, id: P1, name: 'x' }, mapping),
    ).toBeNull();
    expect(
      parseAssortmentRow({ meta: { type: 'variant' }, id: V1, name: 'x' }, mapping),
    ).toBeNull();
    expect(parseAssortmentRow('x', mapping)).toBeNull();
  });
});

describe('stock report and webhook parsing', () => {
  it('sums free stock per assortment and filters by store', () => {
    const rows = [
      { assortmentId: P1, storeId: 's1', freeStock: 5 },
      { assortmentId: P1, storeId: 's2', freeStock: 7 },
      { assortmentId: V1, storeId: null, freeStock: -2 },
      { assortmentId: V1, storeId: 's1', freeStock: 3 },
      { bad: true },
    ];
    expect([...parseStockCurrent(rows, 's1')]).toEqual([
      [P1, 5],
      [V1, 3],
    ]);
    expect(parseStockCurrent(rows, null).get(P1)).toBe(12);
  });

  it('turns entity events into re-read targets and detects stock notifications', () => {
    const body = {
      auditContext: { uid: 'admin@x' },
      events: [
        { meta: { type: 'product', href: `${BASE}/entity/product/${P1}` }, action: 'UPDATE' },
        {
          meta: { type: 'customerorder', href: `${BASE}/entity/customerorder/${P1}` },
          action: 'UPDATE',
        },
        { meta: { type: 'variant', href: `${BASE}/entity/variant/${V1}` }, action: 'DELETE' },
      ],
    };
    expect(parseWebhookBody(body)).toEqual({
      events: [
        { type: 'product', externalId: P1, action: 'UPDATE' },
        { type: 'variant', externalId: V1, action: 'DELETE' },
      ],
      stock: false,
    });
    expect(parseWebhookBody({ reportUrl: `${BASE}/report/stock/all/current?x` }).stock).toBe(true);
    expect(parseWebhookBody('garbage')).toEqual({ events: [], stock: false });
  });
});

describe('customer order body and errors', () => {
  it('references entities by meta.href, prices in tiyin, reserve = qty', () => {
    const body = buildCustomerOrderBody(
      {
        name: 'F-10482',
        counterpartyId: 'cp',
        organizationId: null,
        storeId: 'st',
        stateName: 'Подтвержден',
        reserve: true,
        description: 'Forest',
        attribute: { name: 'dostavka', value: 'YANDEX · tashkent' },
        positions: [
          { externalId: P1, type: 'product', qty: 2, priceTiyin: 32_900_000n, discountPercent: 10 },
        ],
      },
      {
        href: (t, id) => `${BASE}/entity/${t}/${id}`,
        organizationId: 'org',
        stateId: 'sid',
        attributeId: 'aid',
      },
    );
    expect(body).toMatchObject({
      name: 'F-10482',
      organization: { meta: { href: `${BASE}/entity/organization/org`, type: 'organization' } },
      agent: { meta: { href: `${BASE}/entity/counterparty/cp` } },
      store: { meta: { href: `${BASE}/entity/store/st` } },
      state: { meta: { href: `${BASE}/entity/customerorder/metadata/states/sid`, type: 'state' } },
      attributes: [{ value: 'YANDEX · tashkent' }],
      positions: [
        {
          quantity: 2,
          price: 32_900_000,
          discount: 10,
          reserve: 2,
          assortment: { meta: { href: `${BASE}/entity/product/${P1}`, type: 'product' } },
        },
      ],
    });
  });

  it('parses the JSON API error envelope', () => {
    const e = parseMoyskladError(412, {
      errors: [{ error: 'Ошибка', code: 3006, error_message: 'Неверный фильтр' }],
    });
    expect(e.status).toBe(412);
    expect(e.code).toBe('3006');
    expect(e.message).toContain('Неверный фильтр');
    expect(parseMoyskladError(500, null).code).toBe('http_500');
  });
});

describe('rate limits', () => {
  const h = (o: Record<string, string>) => new Headers(o);

  it('waits X-Lognex-Retry-After ms, briefly on the parallel limit, else backs off', () => {
    expect(moysklad429DelayMs(h({ 'x-lognex-retry-after': '1500' }), 1)).toBe(1500);
    expect(moysklad429DelayMs(h({ 'x-lognex-retry-after': '999999' }), 1)).toBe(30_000);
    expect(moysklad429DelayMs(h({ 'x-lognex-auth': '429005' }), 2)).toBe(500);
    expect(moysklad429DelayMs(h({}), 3)).toBe(4000);
  });

  it('throttles only when the window is almost spent', () => {
    const base = { 'x-ratelimit-limit': '45', 'x-lognex-retry-timeinterval': '3000' };
    expect(moyskladThrottleMs(h({ ...base, 'x-ratelimit-remaining': '30' }))).toBe(0);
    expect(moyskladThrottleMs(h({ ...base, 'x-ratelimit-remaining': '2' }))).toBe(67);
    expect(moyskladThrottleMs(h({}))).toBe(0);
  });

  it('retries a 429 for any method (MoySklad never executed it) and keeps ≤ 2 in flight', async () => {
    let inflight = 0;
    let peak = 0;
    const calls: string[] = [];
    const queue = [429, 200, 200, 200, 200];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      inflight++;
      peak = Math.max(peak, inflight);
      calls.push(init?.method ?? 'GET');
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      const status = queue.shift() ?? 200;
      return new Response('{}', {
        status,
        headers: status === 429 ? { 'x-lognex-retry-after': '10' } : {},
      });
    }) as unknown as typeof fetch;
    const sleep = vi.fn(async () => undefined);
    const f = createMoyskladFetch({ fetchImpl, sleep });
    const first = await f('https://x', { method: 'POST' });
    expect(first.status).toBe(200);
    expect(calls).toEqual(['POST', 'POST']);
    expect(sleep).toHaveBeenCalledWith(10);
    await Promise.all([1, 2, 3].map(() => f('https://x')));
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('gives up after the 429 budget and lets HttpClient see the 429', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch;
    const f = createMoyskladFetch({ fetchImpl, sleep: async () => undefined, max429Retries: 2 });
    expect((await f('https://x')).status).toBe(429);
  });
});

describe('MoyskladInventoryProvider requests', () => {
  it('sends Bearer + gzip and refuses links outside the API base', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return new Response(
        JSON.stringify({ meta: { nextHref: 'https://evil.example/api' }, rows: [{ id: P1 }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const p = new MoyskladInventoryProvider(
      { token: 't0k' },
      { http: new HttpClient('ms-test', { fetchImpl, maxRetries: 0 }), baseUrl: BASE },
    );
    expect(await p.findCustomerOrder('F-1')).toBe(P1);
    expect(seen[0]?.url).toBe(`${BASE}/entity/customerorder?filter=name%3DF-1&limit=1`);
    expect(seen[0]?.headers).toMatchObject({
      Authorization: 'Bearer t0k',
      'Accept-Encoding': 'gzip',
    });
    await expect(p.listAssortment(mapping)).rejects.toThrow(/bad_href/);
  });
});
