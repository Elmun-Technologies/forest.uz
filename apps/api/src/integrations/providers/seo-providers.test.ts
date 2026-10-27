import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  gscQueryBody,
  parseGscRows,
  parseServiceAccount,
  parseYwmPopular,
  serviceAccountAssertion,
  ywmPopularQuery,
} from './seo-search';
import { indexNowOutcome, indexNowPayloads, isPublicSite, parsePageSpeed } from './seo-tools';

describe('IndexNow', () => {
  it('builds one payload per 10 000 own-host URLs with the root key file', () => {
    const urls = [
      'https://forest.uz/uz/p/a',
      'https://forest.uz/ru/p/a',
      'https://forest.uz/uz/p/a',
      'https://evil.com/x',
      'not a url',
    ];
    expect(indexNowPayloads('https://forest.uz', 'abcdef0123456789', urls)).toEqual([
      {
        host: 'forest.uz',
        key: 'abcdef0123456789',
        keyLocation: 'https://forest.uz/abcdef0123456789.txt',
        urlList: ['https://forest.uz/uz/p/a', 'https://forest.uz/ru/p/a'],
      },
    ]);
    const many = Array.from({ length: 10_001 }, (_, i) => `https://forest.uz/uz/p/${i}`);
    expect(
      indexNowPayloads('https://forest.uz', 'k'.repeat(8), many).map((p) => p.urlList.length),
    ).toEqual([10_000, 1]);
  });

  it('pings only public https hosts and reads engine statuses', () => {
    expect(isPublicSite('https://forest.uz')).toBe(true);
    expect(isPublicSite('http://forest.uz')).toBe(false);
    expect(isPublicSite('https://localhost:3000')).toBe(false);
    expect(isPublicSite('https://192.168.1.5')).toBe(false);
    expect(indexNowOutcome(200).ok).toBe(true);
    expect(indexNowOutcome(202)).toEqual({
      ok: true,
      message: 'HTTP 202 accepted (key validation pending)',
    });
    expect(indexNowOutcome(403).ok).toBe(false);
  });
});

describe('Google Search Console', () => {
  it('signs an RS256 jwt-bearer assertion with the service account key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const sa = parseServiceAccount(
      JSON.stringify({ client_email: 'seo@p.iam.gserviceaccount.com', private_key: pem }),
    )!;
    const jwt = serviceAccountAssertion(sa, 1_700_000_000);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(p!, 'base64url').toString())).toEqual({
      iss: 'seo@p.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    expect(
      createVerify('RSA-SHA256')
        .update(`${h}.${p}`)
        .verify(publicKey, Buffer.from(s!, 'base64url')),
    ).toBe(true);
    expect(parseServiceAccount('{"client_email":1}')).toBeNull();
  });

  it('queries [date, query] and parses rows defensively', () => {
    expect(gscQueryBody('2026-10-20', '2026-10-24', 0)).toMatchObject({
      dimensions: ['date', 'query'],
      rowLimit: 25_000,
      startRow: 0,
      type: 'web',
    });
    expect(
      parseGscRows({
        rows: [
          {
            keys: ['2026-10-20', 'mebel uchun kraska'],
            clicks: 3,
            impressions: 40,
            ctr: 0.075,
            position: 4.2,
          },
          { keys: ['bad'], clicks: 1 },
        ],
      }),
    ).toEqual([
      {
        date: '2026-10-20',
        query: 'mebel uchun kraska',
        clicks: 3,
        impressions: 40,
        position: 4.2,
      },
    ]);
    expect(parseGscRows({})).toEqual([]);
  });
});

describe('Yandex Webmaster', () => {
  it('asks for one day of popular queries with repeated indicators', () => {
    const q = new URLSearchParams(ywmPopularQuery('2026-10-20', 500));
    expect(q.get('date_from')).toBe('2026-10-20T00:00:00.000Z');
    expect(q.get('date_to')).toBe('2026-10-20T23:59:59.999Z');
    expect(q.getAll('query_indicator')).toEqual([
      'TOTAL_SHOWS',
      'TOTAL_CLICKS',
      'AVG_SHOW_POSITION',
    ]);
    expect(q.get('offset')).toBe('500');
    expect(daysBetween('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('maps indicators to clicks/impressions/position', () => {
    expect(
      parseYwmPopular('2026-10-20', {
        queries: [
          {
            query_id: 'x',
            query_text: 'краска для дивана',
            indicators: { TOTAL_SHOWS: 120, TOTAL_CLICKS: 4, AVG_SHOW_POSITION: 7.81 },
          },
          { query_text: '' },
        ],
      }),
    ).toEqual([
      {
        date: '2026-10-20',
        query: 'краска для дивана',
        clicks: 4,
        impressions: 120,
        position: 7.81,
      },
    ]);
  });
});

describe('PageSpeed Insights', () => {
  it('reads Lighthouse lab values', () => {
    expect(
      parsePageSpeed({
        lighthouseResult: {
          categories: { performance: { score: 0.89 } },
          audits: {
            'largest-contentful-paint': { numericValue: 2134.6 },
            'cumulative-layout-shift': { numericValue: 0.01234 },
            'total-blocking-time': { numericValue: 120.2 },
            'first-contentful-paint': { numericValue: 900 },
          },
        },
      }),
    ).toEqual({ score: 89, lcpMs: 2135, cls: 0.012, tbtMs: 120, fcpMs: 900 });
    expect(parsePageSpeed({})).toEqual({
      score: null,
      lcpMs: null,
      cls: null,
      tbtMs: null,
      fcpMs: null,
    });
  });
});
