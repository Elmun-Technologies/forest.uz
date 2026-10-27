import { describe, expect, it } from 'vitest';
import {
  allocateByShares,
  ATTRIBUTION_MAX_TOUCHES,
  type AttributionTouch,
  attributeTouches,
  attributionShares,
  parseOrderAttribution,
} from './attribution';

const t = (
  channel: string,
  at: string,
  extra: Partial<AttributionTouch> = {},
): AttributionTouch => ({
  at,
  kind: 'session',
  channel,
  source: channel,
  medium: '(none)',
  campaign: null,
  sessionId: null,
  ...extra,
});

describe('attributionShares', () => {
  const journey = [{ channel: 'paid_instagram' }, { channel: 'telegram' }, { channel: 'direct' }];

  it('first touch: everything to the first touch', () => {
    expect(attributionShares(journey, 'first_touch')).toEqual([1, 0, 0]);
  });

  it('last non-direct: skips trailing direct visits', () => {
    expect(attributionShares(journey, 'last_non_direct')).toEqual([0, 1, 0]);
    expect(
      attributionShares([{ channel: 'direct' }, { channel: 'sms' }], 'last_non_direct'),
    ).toEqual([0, 1]);
  });

  it('last non-direct: an all-direct journey credits the last touch', () => {
    expect(
      attributionShares([{ channel: 'direct' }, { channel: 'direct' }], 'last_non_direct'),
    ).toEqual([0, 1]);
  });

  it('linear: equal parts summing to 1', () => {
    const s = attributionShares([...journey, { channel: 'bot' }], 'linear');
    expect(s).toEqual([0.25, 0.25, 0.25, 0.25]);
    const three = attributionShares(journey, 'linear');
    expect(three.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('empty journey → no shares', () => {
    expect(attributionShares([], 'linear')).toEqual([]);
    expect(attributionShares([], 'first_touch')).toEqual([]);
  });

  it('every model sums to 1 for any non-empty journey', () => {
    for (let n = 1; n <= 7; n++) {
      const js = Array.from({ length: n }, (_, i) => ({ channel: i % 2 ? 'direct' : 'referral' }));
      for (const m of ['first_touch', 'last_non_direct', 'linear'] as const)
        expect(attributionShares(js, m).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
  });
});

describe('attributeTouches', () => {
  it('sorts by time and stores every model on each touch', () => {
    const a = attributeTouches(
      [t('direct', '2026-10-03T10:00:00Z'), t('paid_facebook', '2026-10-01T10:00:00Z')],
      new Date('2026-10-04T00:00:00Z'),
    );
    expect(a.v).toBe(1);
    expect(a.computedAt).toBe('2026-10-04T00:00:00.000Z');
    expect(a.touches.map((x) => x.channel)).toEqual(['paid_facebook', 'direct']);
    expect(a.touches[0]!.shares).toEqual({ first_touch: 1, last_non_direct: 1, linear: 0.5 });
    expect(a.touches[1]!.shares).toEqual({ first_touch: 0, last_non_direct: 0, linear: 0.5 });
  });

  it('keeps the latest touches only', () => {
    const many = Array.from({ length: ATTRIBUTION_MAX_TOUCHES + 5 }, (_, i) =>
      t(
        i === 0 ? 'paid_google' : 'referral',
        new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
      ),
    );
    const a = attributeTouches(many, new Date());
    expect(a.touches).toHaveLength(ATTRIBUTION_MAX_TOUCHES);
    expect(a.touches.some((x) => x.channel === 'paid_google')).toBe(false);
  });

  it('round-trips through parseOrderAttribution; foreign shapes are rejected', () => {
    const a = attributeTouches([t('telegram', '2026-10-01T00:00:00Z')], new Date());
    expect(parseOrderAttribution(JSON.parse(JSON.stringify(a)))).toEqual(a);
    expect(parseOrderAttribution(null)).toBeNull();
    expect(parseOrderAttribution({ firstTouch: {} })).toBeNull();
    expect(
      parseOrderAttribution({ v: 1, computedAt: 'x', touches: [{ channel: 'a' }] }),
    ).toBeNull();
  });
});

describe('allocateByShares', () => {
  it('splits without losing a tiyin', () => {
    const parts = allocateByShares(100n, [1 / 3, 1 / 3, 1 / 3]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(parts).toEqual([34n, 33n, 33n]);
  });

  it('follows the shares and handles zeros', () => {
    expect(allocateByShares(94_600_000n, [0, 1, 0])).toEqual([0n, 94_600_000n, 0n]);
    expect(allocateByShares(1_000n, [0.25, 0.25, 0.5])).toEqual([250n, 250n, 500n]);
    expect(allocateByShares(5n, [])).toEqual([]);
    expect(allocateByShares(5n, [0, 0])).toEqual([0n, 0n]);
  });
});
