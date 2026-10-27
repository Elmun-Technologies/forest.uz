import { canTransitionDelivery, DELIVERY_STATUSES } from '@forest/contracts';
import { HttpClient } from '../http-client';
import type { ShipmentInput } from './types';
import {
  buildCheckPriceBody,
  buildClaimBody,
  decimalSoumToTiyin,
  isYandexTerminal,
  parseClaim,
  parseDestinationEta,
  YANDEX_CLAIM_STATUSES,
  yandexCallbackKey,
  yandexCallbackUrl,
  yandexConfig,
  YandexDeliveryProvider,
  yandexStatusToDelivery,
} from './yandex-delivery';

const creds = {
  oauthToken: 'y0_test-token',
  sourceAddress: 'Toshkent, Chilonzor 9-kvartal, 5',
  sourceLat: '41.2850',
  sourceLng: '69.2040',
  sourceContactName: 'Forest ombor',
  sourceContactPhone: '+998901234567',
  mode: 'live',
};

const input: ShipmentInput = {
  orderNumber: 'F-10482',
  recipientName: 'Malika',
  recipientPhone: '+998902223344',
  address: {
    region: 'Toshkent shahri',
    district: 'Yunusobod',
    line: '4-kvartal, 12-uy',
    lat: 41.36,
    lng: 69.29,
  },
  weightGrams: 2500,
  itemsCount: 2,
  codAmountTiyin: null,
  comment: 'Domofon 12',
  idempotencyKey: 'shp1-1',
  items: [
    {
      title: 'Chalk White, 1 L',
      sku: 'FR-CW-1',
      qty: 2,
      unitPriceTiyin: 32_900_000n,
      weightGrams: 1250,
    },
  ],
};

describe('Yandex status mapping', () => {
  it('maps every documented claim status', () => {
    for (const s of YANDEX_CLAIM_STATUSES) expect(yandexStatusToDelivery(s)).not.toBeNull();
    expect(yandexStatusToDelivery('teleported')).toBeNull();
  });

  it('maps the milestones that drive order transitions', () => {
    expect(yandexStatusToDelivery('ready_for_approval')).toBe('CREATED');
    expect(yandexStatusToDelivery('performer_lookup')).toBe('CREATED');
    expect(yandexStatusToDelivery('performer_found')).toBe('COURIER_ASSIGNED');
    expect(yandexStatusToDelivery('pickuped')).toBe('PICKED_UP');
    expect(yandexStatusToDelivery('delivery_arrived')).toBe('IN_TRANSIT');
    expect(yandexStatusToDelivery('delivered_finish')).toBe('DELIVERED');
    expect(yandexStatusToDelivery('returning')).toBe('FAILED');
    expect(yandexStatusToDelivery('returned_finish')).toBe('RETURNED');
    expect(yandexStatusToDelivery('cancelled_by_taxi')).toBe('FAILED');
    expect(yandexStatusToDelivery('performer_not_found')).toBe('FAILED');
  });

  it('the happy and return paths are allowed by the delivery state machine', () => {
    const path = [
      'new',
      'performer_found',
      'pickuped',
      'delivery_arrived',
      'delivered',
      'delivered_finish',
    ];
    const back = ['pickuped', 'returning', 'returned'];
    for (const p of [path, back]) {
      const mapped = p.map((s) => yandexStatusToDelivery(s)!);
      for (let i = 1; i < mapped.length; i++) {
        if (mapped[i] !== mapped[i - 1])
          expect(canTransitionDelivery(mapped[i - 1]!, mapped[i]!)).toBe(true);
      }
    }
    expect(DELIVERY_STATUSES).toContain('FAILED');
  });

  it('knows which statuses are final', () => {
    expect(isYandexTerminal('delivered_finish')).toBe(true);
    expect(isYandexTerminal('cancelled')).toBe(true);
    expect(isYandexTerminal('delivered')).toBe(false);
    expect(isYandexTerminal('returning')).toBe(false);
  });
});

describe('Yandex request builders', () => {
  const config = yandexConfig(creds);

  it('parses credentials; the warehouse needs address, coordinates and a contact', () => {
    expect(config.warehouse).toEqual({
      fullname: creds.sourceAddress,
      lat: 41.285,
      lng: 69.204,
      contactName: 'Forest ombor',
      contactPhone: '+998901234567',
    });
    expect(config.mode).toBe('live');
    expect(config.taxiClass).toBe('express');
    expect(yandexConfig({ ...creds, sourceLat: '' }).warehouse).toBeNull();
    expect(yandexConfig({ ...creds, mode: 'anything' }).mode).toBe('test');
  });

  it('check-price: [lng, lat] points, kg weight, taxi class', () => {
    const body = buildCheckPriceBody(
      config.warehouse!,
      { lat: 41.36, lng: 69.29, fullname: 'Yunusobod' },
      2500,
      'express',
    );
    expect(body.route_points[0]).toEqual({
      id: 1,
      coordinates: [69.204, 41.285],
      fullname: creds.sourceAddress,
    });
    expect(body.route_points[1]?.coordinates).toEqual([69.29, 41.36]);
    expect(body.items).toEqual([{ quantity: 1, weight: 2.5, pickup_point: 1 }]);
    expect(body.requirements).toEqual({ taxi_class: 'express' });
  });

  it('claims/create: source + destination points, UZS items, never auto_accept', () => {
    const body = buildClaimBody(
      input,
      { ...config, warehouse: config.warehouse! },
      'https://api.test/cb?key=k&',
    );
    expect(body).not.toHaveProperty('auto_accept');
    expect(body.route_points.map((p) => [p.point_id, p.visit_order, p.type])).toEqual([
      [1, 1, 'source'],
      [2, 2, 'destination'],
    ]);
    expect(body.route_points[1]).toMatchObject({
      contact: { name: 'Malika', phone: '+998902223344' },
      address: {
        fullname: 'Toshkent shahri, Yunusobod, 4-kvartal, 12-uy',
        coordinates: [69.29, 41.36],
      },
      external_order_id: 'F-10482',
    });
    expect(body.items).toEqual([
      {
        title: 'Chalk White, 1 L',
        quantity: 2,
        cost_value: '329000.00',
        cost_currency: 'UZS',
        weight: 1.25,
        pickup_point: 1,
        extra_id: 'FR-CW-1',
      },
    ]);
    expect(body.client_requirements).toEqual({ taxi_class: 'express' });
    expect(body.callback_properties).toEqual({ callback_url: 'https://api.test/cb?key=k&' });
    expect(body.comment).toBe('Domofon 12');
  });

  it('claims/create without customer coordinates sends the address text only; COD amount goes to the comment', () => {
    const body = buildClaimBody(
      {
        ...input,
        address: { ...input.address, lat: null, lng: null },
        codAmountTiyin: 65_800_000n,
        comment: null,
      },
      { ...config, warehouse: config.warehouse! },
      null,
    );
    expect(body.route_points[1]?.address).not.toHaveProperty('coordinates');
    expect(body).not.toHaveProperty('callback_properties');
    expect(body.comment).toContain('658000.00 UZS');
  });

  it('callback URL ends with & (Yandex appends its parameters) and carries a stable secret', () => {
    const url = yandexCallbackUrl('https://api.forest.uz/', 'secret');
    expect(url).toBe(
      `https://api.forest.uz/v1/webhooks/yandex-delivery?key=${yandexCallbackKey('secret')}&`,
    );
    expect(yandexCallbackKey('secret')).not.toBe(yandexCallbackKey('other'));
  });
});

describe('Yandex response parsing', () => {
  it("decimal so'm → tiyin, rounding up fractions of a tiyin", () => {
    expect(decimalSoumToTiyin('27500.00')).toBe(2_750_000n);
    expect(decimalSoumToTiyin('27500.5')).toBe(2_750_050n);
    expect(decimalSoumToTiyin('0.001')).toBe(1n);
    expect(decimalSoumToTiyin(1200)).toBe(120_000n);
    expect(decimalSoumToTiyin('abc')).toBeNull();
    expect(decimalSoumToTiyin(null)).toBeNull();
  });

  it('claims/info: status, version, updated_ts, performer and price', () => {
    const c = parseClaim({
      id: 'c1',
      status: 'performer_found',
      version: 3,
      updated_ts: '2026-10-27T10:00:00+05:00',
      pricing: { currency: 'UZS', final_price: '27500.00', offer: { price: '26000.00' } },
      performer_info: {
        courier_name: 'Aziz Karimov',
        car_model: 'Damas',
        car_color: 'oq',
        car_number: '01A123BC',
      },
      error_messages: [{ code: 'x', message: 'y' }],
    });
    expect(c).toMatchObject({
      id: 'c1',
      status: 'performer_found',
      version: 3,
      priceTiyin: 2_750_000n,
      currency: 'UZS',
    });
    expect(c.updatedAt?.toISOString()).toBe('2026-10-27T05:00:00.000Z');
    expect(c.performer).toEqual({
      name: 'Aziz Karimov',
      car: 'oq Damas',
      plate: '01A123BC',
      transport: null,
    });
    expect(c.errors).toEqual([{ code: 'x', message: 'y' }]);
    expect(() => parseClaim({ status: 'new' })).toThrow();
  });

  it('points-eta: expected time at the destination point', () => {
    expect(
      parseDestinationEta({
        route_points: [
          { type: 'source', visited_at: { expected: '2026-10-27T10:00:00Z' } },
          { type: 'destination', visited_at: { expected: '2026-10-27T10:40:00Z' } },
        ],
      })?.toISOString(),
    ).toBe('2026-10-27T10:40:00.000Z');
    expect(parseDestinationEta({})).toBeNull();
  });
});

describe('YandexDeliveryProvider (HTTP)', () => {
  function stub(
    handler: (url: URL, init: RequestInit) => { status: number; body: unknown } | Error,
  ) {
    const calls: { url: URL; init: RequestInit }[] = [];
    const impl = (async (u: string, init: RequestInit) => {
      const url = new URL(u);
      calls.push({ url, init });
      const r = handler(url, init);
      if (r instanceof Error) throw r;
      return new Response(JSON.stringify(r.body), { status: r.status });
    }) as unknown as typeof fetch;
    const http = new HttpClient('yandex_delivery', {
      fetchImpl: impl,
      sleep: async () => undefined,
    });
    return { calls, http };
  }
  const claim = (status: string, extra: Record<string, unknown> = {}) => ({
    status: 200,
    body: { id: 'claim-1', status, version: 2, updated_ts: '2026-10-27T05:00:00Z', ...extra },
  });

  it('create: request_id in the query, Bearer token, retried with the same request_id', async () => {
    let n = 0;
    const s = stub((url) =>
      url.pathname.endsWith('/claims/create') && ++n === 1
        ? new Error('socket hang up')
        : claim('new'),
    );
    const p = new YandexDeliveryProvider(creds, { http: s.http, baseUrl: 'http://yd.test' });
    const res = await p.createShipment(input);
    expect(res.externalId).toBe('claim-1');
    expect(s.calls).toHaveLength(2);
    for (const c of s.calls) {
      expect(c.url.pathname).toBe('/b2b/cargo/integration/v2/claims/create');
      expect(c.url.searchParams.get('request_id')).toBe('shp1-1');
      expect((c.init.headers as Record<string, string>).Authorization).toBe('Bearer y0_test-token');
    }
  });

  it('accept: claim_id in the query, version in the body, never retried', async () => {
    const s = stub((url) =>
      url.pathname.endsWith('/claims/accept') ? new Error('timeout') : claim('ready_for_approval'),
    );
    const p = new YandexDeliveryProvider(creds, { http: s.http, baseUrl: 'http://yd.test' });
    await expect(p.accept('claim-1', 2)).rejects.toThrow();
    const accepts = s.calls.filter((c) => c.url.pathname.endsWith('/claims/accept'));
    expect(accepts).toHaveLength(1);
    expect(accepts[0]?.url.searchParams.get('claim_id')).toBe('claim-1');
    expect(JSON.parse(String(accepts[0]?.init.body))).toEqual({ version: 2 });
  });

  it('accept is refused in test mode without calling Yandex', async () => {
    const s = stub(() => claim('ready_for_approval'));
    const p = new YandexDeliveryProvider(
      { ...creds, mode: 'test' },
      { http: s.http, baseUrl: 'http://yd.test' },
    );
    await expect(p.accept('claim-1')).rejects.toThrow(/test_mode/);
    expect(s.calls).toHaveLength(0);
  });

  it('cancel: checks cancel-info first; paid needs consent; sends version + cancel_state', async () => {
    let state = 'paid';
    const s = stub((url) =>
      url.pathname.endsWith('/claims/cancel-info')
        ? { status: 200, body: { cancel_state: state, price: '5000.00' } }
        : claim('performer_found'),
    );
    const p = new YandexDeliveryProvider(creds, { http: s.http, baseUrl: 'http://yd.test' });
    await expect(p.cancel('claim-1')).rejects.toThrow(/cancel_paid/);
    await p.cancel('claim-1', { allowPaid: true });
    const cancel = s.calls.find((c) => c.url.pathname.endsWith('/claims/cancel'));
    expect(JSON.parse(String(cancel?.init.body))).toEqual({ version: 2, cancel_state: 'paid' });
    state = 'unavailable';
    await expect(p.cancel('claim-1', { allowPaid: true })).rejects.toThrow(/cancel_unavailable/);
  });

  it('getState adds ETA and the forwarded phone while a courier is on the claim', async () => {
    const s = stub((url) => {
      if (url.pathname.endsWith('/claims/points-eta'))
        return {
          status: 200,
          body: {
            route_points: [
              { type: 'destination', visited_at: { expected: '2026-10-27T06:00:00Z' } },
            ],
          },
        };
      if (url.pathname.endsWith('/driver-voiceforwarding'))
        return { status: 200, body: { phone: '+79099999998', ext: '0163', ttl_seconds: 600 } };
      return claim('pickuped', {
        performer_info: { courier_name: 'Aziz', car_model: 'Damas', car_number: '01A' },
      });
    });
    const p = new YandexDeliveryProvider(creds, { http: s.http, baseUrl: 'http://yd.test' });
    const st = await p.getState('claim-1', { withPhone: true });
    expect(st).toMatchObject({
      status: 'PICKED_UP',
      providerStatus: 'pickuped',
      version: 2,
      terminal: false,
    });
    expect(st.courier).toMatchObject({
      name: 'Aziz',
      phone: '+79099999998',
      phoneExt: '0163',
      plate: '01A',
    });
    expect(st.courier?.etaAt?.toISOString()).toBe('2026-10-27T06:00:00.000Z');
    const noPhone = await p.getState('claim-1');
    expect(noPhone.courier?.phone).toBeNull();
  });

  it('quote: null without coordinates or for a non-UZS answer, else UZS price in tiyin', async () => {
    let code = 'UZS';
    const s = stub(() => ({
      status: 200,
      body: { price: '27500.00', currency_rules: { code }, eta: 25 },
    }));
    const p = new YandexDeliveryProvider(creds, { http: s.http, baseUrl: 'http://yd.test' });
    expect(await p.quote({ region: 'x', line: 'y' }, 1000)).toBeNull();
    expect(s.calls).toHaveLength(0);
    expect(await p.quote({ region: 'x', line: 'y', lat: 41.3, lng: 69.2 }, 1000)).toEqual({
      priceTiyin: 2_750_000n,
      etaMinutes: 25,
    });
    code = 'RUB';
    expect(await p.quote({ region: 'x', line: 'y', lat: 41.3, lng: 69.2 }, 1000)).toBeNull();
  });

  it('API errors surface code and HTTP status; health check reports a rejected token', async () => {
    const s = stub(() => ({ status: 401, body: { code: 'unauthorized', message: 'bad token' } }));
    const p = new YandexDeliveryProvider(creds, { http: s.http, baseUrl: 'http://yd.test' });
    await expect(p.claimInfo('claim-1')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
    expect(await p.test()).toEqual({ ok: false, message: 'token rejected by Yandex (401/403)' });
  });
});
