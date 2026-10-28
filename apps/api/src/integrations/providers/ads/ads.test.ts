import { HttpClient } from '../../http-client';
import {
  failedIndexes,
  googleClickConversion,
  googleDateTime,
  GoogleAdsProvider,
} from './google-ads';
import { metaServerEvent, MetaAdsProvider } from './meta';
import { tiktokEvent, TiktokAdsProvider } from './tiktok';
import { type AdConversion, hashPhone, sha256Hex } from './types';
import { YandexAudienceProvider } from './yandex-audience';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** HttpClient over a scripted fetch: records each call, answers from `reply`. */
function stub(reply: (c: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body =
      init.body instanceof Uint8Array
        ? Buffer.from(init.body).toString('utf8')
        : typeof init.body === 'string'
          ? init.body
          : '';
    const call = {
      url,
      method: String(init.method),
      headers: (init.headers ?? {}) as Record<string, string>,
      body,
    };
    calls.push(call);
    const r = reply(call);
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), {
      status: r.status ?? 200,
    });
  }) as unknown as typeof fetch;
  return { calls, http: new HttpClient('test', { fetchImpl, maxRetries: 0 }) };
}

const AT = new Date('2026-10-27T10:00:00.000Z');
const conversion = (over: Partial<AdConversion> = {}): AdConversion => ({
  eventId: '0193a1b2-0000-7000-8000-000000000001',
  name: 'purchase',
  at: AT,
  url: 'https://forest.uz/uz/checkout',
  valueSoum: 450_000,
  orderNumber: 'F-10482',
  phone: '+998901234567',
  customerId: 'cust_1',
  clickIds: {},
  clickAt: null,
  ...over,
});

describe('phone hashing vectors (platform rules, docs/runbooks/ads.md)', () => {
  it('SHA-256 hex of the normalised value', () => {
    // TikTok GTM template test vector: '1231231234' → 065f45b3…
    expect(sha256Hex('1231231234')).toBe(
      '065f45b37b5dad20b5a67158468161cdf35b1ae3cda2a666e7852feab7424897',
    );
    // Meta: digits only (SDK: "+1 (415) 555-0100" and "14155550100" hash alike).
    expect(hashPhone('+998901234567', 'meta')).toBe(
      '172443bcef1ac1d3905d3ff30a9b7c1d188a583c54f24ab8327a91f82054f2d3',
    );
    expect(hashPhone('+1 (415) 555-0100', 'meta')).toBe(
      '5e7ec4c79ccac6e420876e65ad0e6b4b2ccf73ec3dccb50297bf2890a1ec73b9',
    );
    expect(hashPhone('+998901234567', 'yandex')).toBe(hashPhone('+998901234567', 'meta'));
    // Google (E.164 with +, whitespace removed — google-ads-python normalize_and_hash).
    expect(hashPhone('+998901234567', 'google')).toBe(
      'b0ff57edaf3b57a5e0923896c2aeb095fc51e0a61d586f5219e70ebdfdeb6f7c',
    );
    expect(hashPhone('+998901234567', 'tiktok')).toBe(hashPhone('+998901234567', 'google'));
  });
});

describe('Meta CAPI + Custom Audiences', () => {
  it('server event: hashed phone/external id, fbc from fbclid, UZS value', () => {
    const ev = metaServerEvent(
      conversion({ clickIds: { fbclid: 'abc' }, clickAt: new Date(1_700_000_000_000) }),
    )!;
    expect(ev).toEqual({
      event_name: 'Purchase',
      event_time: Math.floor(AT.getTime() / 1000),
      event_id: '0193a1b2-0000-7000-8000-000000000001',
      action_source: 'other',
      event_source_url: 'https://forest.uz/uz/checkout',
      user_data: {
        ph: ['172443bcef1ac1d3905d3ff30a9b7c1d188a583c54f24ab8327a91f82054f2d3'],
        external_id: [sha256Hex('cust_1')],
        fbc: 'fb.1.1700000000000.abc',
      },
      custom_data: { currency: 'UZS', value: 450_000, order_id: 'F-10482' },
    });
    expect(JSON.stringify(ev)).not.toContain('998901234567');
  });

  it('posts to /{pixel}/events with the token in the body, test code when set', async () => {
    const { calls, http } = stub(() => ({ body: { events_received: 1 } }));
    const meta = new MetaAdsProvider(
      { pixelId: '123', accessToken: 'tok', testEventCode: 'TEST1' },
      { http, baseUrl: 'https://graph.test/v26.0' },
    );
    const r = await meta.send([
      conversion(),
      conversion({ eventId: 'e2', phone: null, customerId: null }),
    ]);
    expect(r.failed.size).toBe(0);
    expect(r.skipped.get('e2')).toBe('no user identifiers');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://graph.test/v26.0/123/events');
    const body = JSON.parse(calls[0]!.body) as Record<string, unknown>;
    expect(body).toMatchObject({ test_event_code: 'TEST1', access_token: 'tok' });
    expect((body.data as unknown[]).length).toBe(1);
  });

  it('a rejected request fails every event of the batch', async () => {
    const { http } = stub(() => ({ status: 400, body: { error: { message: 'bad' } } }));
    const meta = new MetaAdsProvider({ pixelId: '1', accessToken: 't' }, { http });
    const r = await meta.send([conversion()]);
    expect(r.failed.get(conversion().eventId)).toContain('HTTP 400');
  });

  it('custom audience: create (empty) in the ad account, then users as PHONE_SHA256', async () => {
    const { calls, http } = stub((c) => ({
      body: c.url.endsWith('/customaudiences') ? { id: '555' } : { num_received: 1 },
    }));
    const meta = new MetaAdsProvider(
      { pixelId: '1', accessToken: 't', adAccountId: '42' },
      { http, baseUrl: 'https://graph.test' },
    );
    // Created empty: the caller stores the id before adding members.
    expect(await meta.create('VIP')).toEqual({ id: '555', seeded: false });
    await meta.add('555', ['h1']);
    await meta.remove('555', ['h2']);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://graph.test/act_42/customaudiences',
      'POST https://graph.test/555/users',
      'DELETE https://graph.test/555/users',
    ]);
    expect(JSON.parse(calls[0]!.body)).toMatchObject({
      subtype: 'CUSTOM',
      customer_file_source: 'USER_PROVIDED_ONLY',
    });
    expect(JSON.parse(calls[1]!.body).payload).toEqual({ schema: 'PHONE_SHA256', data: ['h1'] });
  });
});

describe('Google Ads conversions + Customer Match', () => {
  it('conversion time is Tashkent with offset', () => {
    expect(googleDateTime(AT)).toBe('2026-10-27 15:00:00+05:00');
  });

  it('click conversion with hashed phone, gclid, order id, consent', () => {
    expect(
      googleClickConversion(conversion({ clickIds: { gclid: 'G1' } }), '1234567890', '77'),
    ).toEqual({
      conversionAction: 'customers/1234567890/conversionActions/77',
      conversionDateTime: '2026-10-27 15:00:00+05:00',
      gclid: 'G1',
      userIdentifiers: [
        { hashedPhoneNumber: 'b0ff57edaf3b57a5e0923896c2aeb095fc51e0a61d586f5219e70ebdfdeb6f7c' },
      ],
      conversionValue: 450_000,
      currencyCode: 'UZS',
      orderId: 'F-10482',
      consent: { adUserData: 'GRANTED' },
    });
    expect(googleClickConversion(conversion({ phone: null }), '1', '2')).toBeNull();
  });

  const creds = {
    developerToken: 'dev',
    customerId: '123-456-7890',
    oauthClientId: 'cid',
    oauthClientSecret: 'cs',
    refreshToken: 'rt',
    conversionActionId: '77',
  };

  it('refreshes the OAuth token once, maps partial failures to events, skips events without an action', async () => {
    const { calls, http } = stub((c) => {
      if (c.url.endsWith('/token')) return { body: { access_token: 'AT', expires_in: 3600 } };
      return {
        body: {
          partialFailureError: {
            details: [
              {
                errors: [
                  { location: { fieldPathElements: [{ fieldName: 'conversions', index: 1 }] } },
                ],
              },
            ],
          },
        },
      };
    });
    const g = new GoogleAdsProvider(creds, {
      http,
      baseUrl: 'https://ads.test/v26',
      tokenUrl: 'https://oauth.test/token',
    });
    const r = await g.send([
      conversion({ eventId: 'a' }),
      conversion({ eventId: 'b' }),
      conversion({ eventId: 'c', name: 'add_to_cart' }),
      conversion({ eventId: 'd', name: 'lead' }),
    ]);
    expect([...r.failed.keys()]).toEqual(['b']);
    expect(r.skipped.get('c')).toContain('no conversion action');
    expect(r.skipped.get('d')).toContain('no conversion action');
    const upload = calls.find((c) => c.url.includes(':uploadClickConversions'))!;
    expect(upload.url).toBe('https://ads.test/v26/customers/1234567890:uploadClickConversions');
    expect(upload.headers).toMatchObject({ Authorization: 'Bearer AT', 'developer-token': 'dev' });
    expect(JSON.parse(upload.body).partialFailure).toBe(true);
    expect(calls.filter((c) => c.url.endsWith('/token'))).toHaveLength(1);
  });

  it('Customer Match: user list, then an offline user data job create → addOperations → run', async () => {
    const { calls, http } = stub((c) => {
      if (c.url.endsWith('/token')) return { body: { access_token: 'AT', expires_in: 3600 } };
      if (c.url.endsWith('userLists:mutate'))
        return { body: { results: [{ resourceName: 'customers/1234567890/userLists/9' }] } };
      if (c.url.endsWith('offlineUserDataJobs:create'))
        return { body: { resourceName: 'customers/1234567890/offlineUserDataJobs/5' } };
      return { body: {} };
    });
    const g = new GoogleAdsProvider(creds, {
      http,
      baseUrl: 'https://ads.test/v26',
      tokenUrl: 'https://oauth.test/token',
    });
    expect(await g.create('VIP')).toEqual({
      id: 'customers/1234567890/userLists/9',
      seeded: false,
    });
    await g.add('customers/1234567890/userLists/9', ['h1']);
    await g.remove('customers/1234567890/userLists/9', ['h2']);
    const paths = calls
      .filter((c) => !c.url.endsWith('/token'))
      .map((c) => c.url.replace('https://ads.test/v26', ''));
    expect(paths).toEqual([
      '/customers/1234567890/userLists:mutate',
      '/customers/1234567890/offlineUserDataJobs:create',
      '/customers/1234567890/offlineUserDataJobs/5:addOperations',
      '/customers/1234567890/offlineUserDataJobs/5:run',
      '/customers/1234567890/offlineUserDataJobs:create',
      '/customers/1234567890/offlineUserDataJobs/5:addOperations',
      '/customers/1234567890/offlineUserDataJobs/5:run',
    ]);
    const ops = (i: number) =>
      JSON.parse(calls.filter((c) => c.url.endsWith(':addOperations'))[i]!.body);
    expect(ops(0).operations).toEqual([
      { create: { userIdentifiers: [{ hashedPhoneNumber: 'h1' }] } },
    ]);
    expect(ops(1).operations).toEqual([
      { remove: { userIdentifiers: [{ hashedPhoneNumber: 'h2' }] } },
    ]);
    const job = JSON.parse(calls.find((c) => c.url.endsWith('offlineUserDataJobs:create'))!.body);
    expect(job.job.customerMatchUserListMetadata).toEqual({
      userList: 'customers/1234567890/userLists/9',
      consent: { adUserData: 'GRANTED', adPersonalization: 'GRANTED' },
    });
  });

  it('failedIndexes ignores malformed errors', () => {
    expect(failedIndexes(undefined)).toEqual([]);
    expect(failedIndexes({ details: [{ errors: [{}] }] })).toEqual([]);
  });
});

describe('TikTok Events API + customer-file audiences', () => {
  it('event: SHA-256 phone (E.164 with +), external id, ttclid', () => {
    expect(tiktokEvent(conversion({ clickIds: { ttclid: 'T1' } }))).toEqual({
      event: 'CompletePayment',
      event_time: Math.floor(AT.getTime() / 1000),
      event_id: conversion().eventId,
      page: { url: 'https://forest.uz/uz/checkout' },
      user: {
        phone: 'b0ff57edaf3b57a5e0923896c2aeb095fc51e0a61d586f5219e70ebdfdeb6f7c',
        external_id: sha256Hex('cust_1'),
        ttclid: 'T1',
      },
      properties: { currency: 'UZS', value: 450_000 },
    });
  });

  it('posts /event/track/ with Access-Token; a non-zero code fails the batch', async () => {
    const { calls, http } = stub(() => ({ body: { code: 40001, message: 'bad token' } }));
    const t = new TiktokAdsProvider(
      { pixelId: 'P', accessToken: 'tok' },
      { http, baseUrl: 'https://tt.test' },
    );
    const r = await t.send([conversion()]);
    expect(r.failed.get(conversion().eventId)).toContain('code 40001');
    expect(calls[0]!.url).toBe('https://tt.test/event/track/');
    expect(calls[0]!.headers['Access-Token']).toBe('tok');
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ event_source: 'web', event_source_id: 'P' });
  });

  it('audience: upload a hash file (MD5 signature), create, then APPEND/REMOVE by file', async () => {
    const { calls, http } = stub((c) => ({
      body: {
        code: 0,
        data: c.url.includes('file/upload') ? { file_path: 'fp1' } : { custom_audience_id: 99 },
      },
    }));
    const t = new TiktokAdsProvider(
      { pixelId: 'P', accessToken: 'tok', advertiserId: 'A' },
      { http, baseUrl: 'https://tt.test' },
    );
    expect(await t.create('VIP', ['h1', 'h2'])).toEqual({ id: '99', seeded: true });
    await t.remove('99', ['h1']);
    expect(calls.map((c) => c.url.replace('https://tt.test', ''))).toEqual([
      '/dmp/custom_audience/file/upload/',
      '/dmp/custom_audience/create/',
      '/dmp/custom_audience/file/upload/',
      '/dmp/custom_audience/update/',
    ]);
    expect(calls[0]!.body).toContain('name="calculate_type"\r\n\r\nPHONE_SHA256');
    expect(calls[0]!.body).toContain('h1\nh2\n');
    expect(JSON.parse(calls[3]!.body)).toEqual({
      advertiser_id: 'A',
      custom_audience_id: '99',
      action: 'REMOVE',
      file_paths: ['fp1'],
    });
  });
});

describe('Yandex Audience', () => {
  it('upload CSV → confirm (hashed, crm) → modify_data addition/subtraction', async () => {
    const { calls, http } = stub((c) => ({
      body: c.url.endsWith('upload_csv_file') ? { segment: { id: 321 } } : { segment: { id: 321 } },
    }));
    const y = new YandexAudienceProvider(
      { oauthToken: 'tok' },
      { http, baseUrl: 'https://ya.test/v1/management' },
    );
    // Upload creates the segment (id stored by the caller), confirm is a separate step.
    expect(await y.create('VIP', ['h1'])).toEqual({ id: '321', seeded: true });
    await y.confirm('321', 'VIP');
    await y.add('321', ['h2']);
    await y.remove('321', ['h1']);
    expect(calls.map((c) => c.url.replace('https://ya.test/v1/management', ''))).toEqual([
      '/segments/upload_csv_file',
      '/segment/321/confirm',
      '/segment/321/modify_data?modification_type=addition',
      '/segment/321/modify_data?modification_type=subtraction',
    ]);
    expect(calls[0]!.headers.Authorization).toBe('OAuth tok');
    expect(calls[0]!.body).toContain('phone\nh1\n');
    expect(JSON.parse(calls[1]!.body)).toEqual({
      segment: { id: 321, name: 'VIP', hashed: true, content_type: 'crm' },
    });
  });
});
