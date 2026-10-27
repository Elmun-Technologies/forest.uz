import { describe, expect, it } from 'vitest';
import {
  AD_SIGNAL_RULES,
  adPhone,
  adSignalBackoffMs,
  AUDIENCE_EVENTS,
  AUDIENCE_LEAD_SOURCES,
  isAudienceEvent,
} from './audiences';
import { LEAD_SOURCES } from './schemas/commerce';
import {
  audienceAutoMessageSchema,
  audiencePreviewQuerySchema,
  audienceRulesSchema,
  segmentCreateSchema,
} from './schemas/admin-audiences';

describe('adPhone (per-platform normalisation before SHA-256)', () => {
  it('Meta and Yandex: digits with country code, no +', () => {
    expect(adPhone('+998901234567', 'meta')).toBe('998901234567');
    expect(adPhone('+998901234567', 'yandex')).toBe('998901234567');
  });

  it('Google and TikTok: E.164 with +', () => {
    expect(adPhone('+998901234567', 'google')).toBe('+998901234567');
    expect(adPhone('+998901234567', 'tiktok')).toBe('+998901234567');
  });

  it('formatting-insensitive (Meta SDK: "+1 (415) 555-0100" = "14155550100")', () => {
    expect(adPhone('+1 (415) 555-0100', 'meta')).toBe(adPhone('14155550100', 'meta'));
  });

  it('rejects numbers that are not phones', () => {
    expect(adPhone('12', 'meta')).toBeNull();
    expect(adPhone('+1234567890123456', 'google')).toBeNull();
  });
});

describe('ad signal backoff', () => {
  it('grows per failure and stays at the last step', () => {
    expect(adSignalBackoffMs(1)).toBe(60_000);
    expect(adSignalBackoffMs(2)).toBe(5 * 60_000);
    expect(adSignalBackoffMs(99)).toBe(AD_SIGNAL_RULES.backoffMs.at(-1));
  });
});

describe('audience vocabulary', () => {
  it('every audience event is a tracker event', () => {
    for (const e of AUDIENCE_EVENTS) expect(isAudienceEvent(e), e).toBe(true);
    expect(isAudienceEvent('click')).toBe(false);
  });

  it('lead sources cover the lead form sources', () => {
    for (const s of LEAD_SOURCES) expect(AUDIENCE_LEAD_SOURCES).toContain(s);
  });
});

describe('audienceRulesSchema', () => {
  const one = (condition: unknown) => ({ groups: [{ conditions: [condition] }] });

  it('strips a locale prefix and adds a leading slash to paths', () => {
    const r = audienceRulesSchema.parse(
      one({
        type: 'page_time',
        path: { op: 'equals', value: '/uz/p/divan' },
        minSeconds: 30,
        withinDays: 30,
        did: true,
      }),
    );
    expect(r.groups[0]!.conditions[0]).toMatchObject({ path: { value: '/p/divan' } });
    const r2 = audienceRulesSchema.parse(
      one({
        type: 'event',
        event: 'view_item',
        did: true,
        withinDays: 7,
        path: { op: 'prefix', value: 'p/' },
      }),
    );
    expect(r2.groups[0]!.conditions[0]).toMatchObject({ path: { value: '/p/' } });
  });

  it('rejects unknown events, condition types, regions and out-of-range numbers', () => {
    expect(
      audienceRulesSchema.safeParse(
        one({ type: 'event', event: 'click', did: true, withinDays: 7 }),
      ).success,
    ).toBe(false);
    expect(audienceRulesSchema.safeParse(one({ type: 'sql', where: '1=1' })).success).toBe(false);
    expect(
      audienceRulesSchema.safeParse(one({ type: 'region', regions: ['mars'], include: true }))
        .success,
    ).toBe(false);
    expect(
      audienceRulesSchema.safeParse(one({ type: 'last_order', op: 'older', days: 0 })).success,
    ).toBe(false);
    expect(audienceRulesSchema.safeParse({ groups: [] }).success).toBe(false);
    expect(audienceRulesSchema.safeParse({ groups: [{ conditions: [] }] }).success).toBe(false);
  });

  it('rejects paths with query strings or spaces', () => {
    expect(
      audienceRulesSchema.safeParse(
        one({
          type: 'event',
          event: 'page_view',
          did: true,
          withinDays: 7,
          path: { op: 'equals', value: '/p/a?x=1' },
        }),
      ).success,
    ).toBe(false);
  });
});

describe('segment inputs', () => {
  it('dedupes destinations and defaults the rest', () => {
    const s = segmentCreateSchema.parse({
      name: '  VIP ',
      rules: { groups: [{ conditions: [{ type: 'orders', metric: 'sum', op: 'gte', value: 1 }] }] },
      destinations: ['meta', 'meta', 'sms'],
    });
    expect(s).toMatchObject({
      name: 'VIP',
      destinations: ['meta', 'sms'],
      active: true,
      autoMessage: null,
    });
  });

  it('auto message: at most three steps, channel telegram|sms', () => {
    expect(
      audienceAutoMessageSchema.safeParse({
        enabled: true,
        steps: [{ channel: 'email', delayMinutes: 0, templateKey: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('preview query decodes base64url JSON rules', () => {
    const rules = { groups: [{ conditions: [{ type: 'lead', has: true }] }] };
    const q = audiencePreviewQuerySchema.parse({
      rules: Buffer.from(JSON.stringify(rules)).toString('base64url'),
    });
    expect(q.rules).toEqual(rules);
    expect(audiencePreviewQuerySchema.safeParse({ rules: 'not-json' }).success).toBe(false);
  });
});
