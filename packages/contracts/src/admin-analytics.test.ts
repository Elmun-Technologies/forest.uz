import { describe, expect, it } from 'vitest';
import {
  adPlatformOfSource,
  analyticsPeriod,
  goalInsight,
  ratio,
  relativeDelta,
  tashkentDayKey,
  tashkentDayKeyStart,
} from './admin-analytics';
import { analyticsQuerySchema, parseAdSpendCsv } from './schemas/admin-analytics';

describe('analytics periods (Asia/Tashkent days)', () => {
  it('day keys follow Tashkent midnight (UTC+5)', () => {
    expect(tashkentDayKey(new Date('2026-10-26T18:59:59Z'))).toBe('2026-10-26');
    expect(tashkentDayKey(new Date('2026-10-26T19:00:00Z'))).toBe('2026-10-27');
    expect(tashkentDayKeyStart('2026-10-27').toISOString()).toBe('2026-10-26T19:00:00.000Z');
  });

  it('N whole days ending today, previous = the N days before', () => {
    const p = analyticsPeriod(7, undefined, new Date('2026-10-27T10:00:00Z'));
    expect(p.firstDay).toBe('2026-10-21');
    expect(p.lastDay).toBe('2026-10-27');
    expect(p.from.toISOString()).toBe('2026-10-20T19:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-10-27T19:00:00.000Z');
    expect(p.prevFrom.toISOString()).toBe('2026-10-13T19:00:00.000Z');
    expect(p.prevTo).toEqual(p.from);
    expect(p.dayKeys).toEqual([
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
    ]);
  });

  it('explicit end day crosses months', () => {
    const p = analyticsPeriod(3, '2026-03-01');
    expect(p.dayKeys).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
  });

  it('ratio / relativeDelta', () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
    expect(relativeDelta(114, 100)).toBeCloseTo(0.14);
    expect(relativeDelta(5, 0)).toBeNull();
    expect(relativeDelta(5, null)).toBeNull();
  });
});

describe('analyticsQuerySchema', () => {
  it('defaults and fallbacks', () => {
    expect(analyticsQuerySchema.parse({})).toEqual({
      days: 30,
      compare: true,
      model: 'last_non_direct',
    });
    const q = analyticsQuerySchema.parse({
      days: '7',
      device: 'mobile',
      compare: '0',
      model: 'linear',
      channel: 'paid_instagram',
      end: '2026-10-01',
    });
    expect(q).toMatchObject({ days: 7, device: 'mobile', compare: false, model: 'linear' });
    expect(analyticsQuerySchema.parse({ days: '11', model: 'x', device: 'tv' })).toMatchObject({
      days: 30,
      model: 'last_non_direct',
      device: undefined,
    });
    expect(analyticsQuerySchema.safeParse({ channel: "x' OR 1=1" }).success).toBe(false);
  });
});

describe('goalInsight', () => {
  const overall = { sessions: 1000, purchasingSessions: 28 };

  it('picks the goal with the highest lift ≥ 1.5', () => {
    const i = goalInsight(
      [
        { name: 'selector_used', sessions: 300, purchasingSessions: 26 },
        { name: 'telegram_click', sessions: 90, purchasingSessions: 9 },
        { name: 'add_to_cart', sessions: 140, purchasingSessions: 28 },
        { name: 'click', sessions: 900, purchasingSessions: 28 },
      ],
      overall,
    );
    expect(i?.name).toBe('telegram_click');
    expect(i?.direction).toBe('up');
    expect(i?.lift).toBeCloseTo(0.1 / 0.028, 6);
  });

  it('falls back to a leak (lift ≤ 0.5) and ignores small samples', () => {
    const i = goalInsight(
      [
        { name: 'popup_shown', sessions: 600, purchasingSessions: 3 },
        { name: 'video_play', sessions: 10, purchasingSessions: 5 },
      ],
      overall,
    );
    expect(i).toMatchObject({ name: 'popup_shown', direction: 'down' });
  });

  it('nothing notable or no purchases → null', () => {
    expect(
      goalInsight([{ name: 'search', sessions: 100, purchasingSessions: 3 }], overall),
    ).toBeNull();
    expect(goalInsight([], { sessions: 0, purchasingSessions: 0 })).toBeNull();
  });
});

describe('ad platforms', () => {
  it('maps utm sources', () => {
    expect(adPlatformOfSource('Instagram')).toBe('meta');
    expect(adPlatformOfSource('google')).toBe('google');
    expect(adPlatformOfSource('telegram')).toBeNull();
    expect(adPlatformOfSource(null)).toBeNull();
  });
});

describe('parseAdSpendCsv', () => {
  it('parses a comma file with quotes and so’m decimals', () => {
    const csv =
      '\uFEFFdate,platform,campaign_id,campaign,adset,spend,impressions,clicks\r\n' +
      '2026-10-01,meta,123,"divan, oldin keyin",reels,"182 000.50",10000,250\r\n' +
      '02.10.2026,instagram,123,,,"1000",,\n';
    const r = parseAdSpendCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      {
        date: '2026-10-01',
        platform: 'meta',
        campaignId: '123',
        campaign: 'divan, oldin keyin',
        adset: 'reels',
        spendTiyin: 18_200_050n,
        impressions: 10000,
        clicks: 250,
      },
      {
        date: '2026-10-02',
        platform: 'meta',
        campaignId: '123',
        campaign: '123',
        adset: null,
        spendTiyin: 100_000n,
        impressions: 0,
        clicks: 0,
      },
    ]);
  });

  it('semicolon files use a decimal comma', () => {
    const r = parseAdSpendCsv('Date;Platform;Campaign_ID;Spend\n2026-10-01;google;g1;1500,5\n');
    expect(r.rows[0]).toMatchObject({ platform: 'google', spendTiyin: 150_050n });
  });

  it('all-or-nothing with line numbers', () => {
    const r = parseAdSpendCsv(
      'date,platform,campaign_id,spend\n' +
        '2026-10-01,meta,1,100\n' +
        '2026-02-30,meta,1,100\n' +
        '2026-10-02,snapchat,1,-5\n' +
        '2026-10-01,meta,1,100\n',
    );
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(r.errors[2]!.message).toContain('takroriy');
  });

  it('missing columns / empty body', () => {
    expect(parseAdSpendCsv('date,platform\n').errors.map((e) => e.message)).toEqual([
      '"campaign_id" ustuni yo\'q',
      '"spend" ustuni yo\'q',
    ]);
    expect(parseAdSpendCsv('date,platform,campaign_id,spend\n').errors).toHaveLength(1);
  });
});
