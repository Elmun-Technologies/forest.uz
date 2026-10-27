import { describe, expect, it } from 'vitest';
import {
  AUTO_EVENTS,
  COMMERCE_EVENTS,
  classifyChannel,
  isCommerceEvent,
  looksLikePii,
  paidPlatform,
  referrerHost,
  scrubPath,
} from './tracking';
import { BROWSER_EVENT_NAMES, trackBatchSchema, trackEventSchema } from './schemas/tracking';

const OWN = ['forest.uz', 'localhost'];

describe('classifyChannel (docs/07 channel rules, first match)', () => {
  it('click ids → paid_<platform>, even with a search referrer', () => {
    expect(classifyChannel({ clickIds: { gclid: 'x' }, referrer: 'https://www.google.com/' })).toBe(
      'paid_google',
    );
    expect(classifyChannel({ clickIds: { fbclid: 'x' } })).toBe('paid_meta');
    expect(classifyChannel({ clickIds: { ttclid: 'x' } })).toBe('paid_tiktok');
    expect(classifyChannel({ clickIds: { yclid: 'x' } })).toBe('paid_yandex');
  });

  it('utm_medium cpc|paid → paid_<utm_source>', () => {
    expect(classifyChannel({ utm: { source: 'facebook', medium: 'cpc' } })).toBe('paid_meta');
    expect(classifyChannel({ utm: { source: 'instagram', medium: 'paid' } })).toBe('paid_meta');
    expect(classifyChannel({ utm: { source: 'Google', medium: 'CPC' } })).toBe('paid_google');
    expect(classifyChannel({ utm: { source: 'tiktok', medium: 'paid_social' } })).toBe(
      'paid_tiktok',
    );
    expect(classifyChannel({ utm: { source: 'Uzum Ads', medium: 'cpc' } })).toBe('paid_uzum_ads');
    expect(classifyChannel({ utm: { medium: 'cpc' } })).toBe('paid_other');
  });

  it('utm_source telegram|t.me or a Telegram referrer → telegram', () => {
    expect(classifyChannel({ utm: { source: 'telegram', medium: 'post' } })).toBe('telegram');
    expect(classifyChannel({ utm: { source: 't.me' } })).toBe('telegram');
    expect(classifyChannel({ referrer: 'https://t.me/forest_uz' })).toBe('telegram');
    expect(classifyChannel({ referrer: 'https://web.telegram.org/k/' })).toBe('telegram');
  });

  it('search engine referrer → organic_search', () => {
    for (const r of [
      'https://www.google.com/',
      'https://www.google.co.uz/',
      'https://yandex.uz/search/?text=x',
      'https://yandex.ru/',
      'https://ya.ru/',
      'https://www.bing.com/',
      'https://duckduckgo.com/',
    ])
      expect(classifyChannel({ referrer: r }), r).toBe('organic_search');
  });

  it('social referrer → organic_social', () => {
    for (const r of [
      'https://l.instagram.com/',
      'https://m.facebook.com/',
      'https://www.tiktok.com/',
      'https://www.youtube.com/',
      'https://vk.com/',
    ])
      expect(classifyChannel({ referrer: r }), r).toBe('organic_social');
  });

  it('utm_medium=sms → sms; bot → bot; email → email', () => {
    expect(classifyChannel({ utm: { source: 'eskiz', medium: 'sms' } })).toBe('sms');
    expect(classifyChannel({ utm: { source: 'bot' } })).toBe('bot');
    expect(classifyChannel({ utm: { source: 'forest', medium: 'bot' } })).toBe('bot');
    expect(classifyChannel({ utm: { source: 'news', medium: 'email' } })).toBe('email');
  });

  it('other referrer (or utm without referrer) → referral; none → direct', () => {
    expect(classifyChannel({ referrer: 'https://mebel-blog.uz/post' })).toBe('referral');
    expect(classifyChannel({ utm: { source: 'partner' } })).toBe('referral');
    expect(classifyChannel({})).toBe('direct');
    expect(classifyChannel({ referrer: '' })).toBe('direct');
  });

  it('own host referrer counts as none', () => {
    expect(classifyChannel({ referrer: 'https://www.forest.uz/uz/katalog', ownHosts: OWN })).toBe(
      'direct',
    );
    expect(classifyChannel({ referrer: 'http://localhost:3000/', ownHosts: OWN })).toBe('direct');
  });

  it('rule order: paid beats telegram, telegram beats search, sms beats other referrers', () => {
    expect(classifyChannel({ utm: { source: 'telegram', medium: 'cpc' } })).toBe('paid_telegram');
    expect(classifyChannel({ utm: { source: 'telegram' }, referrer: 'https://google.com' })).toBe(
      'telegram',
    );
    expect(classifyChannel({ utm: { medium: 'sms' }, referrer: 'https://x.uz' })).toBe('sms');
    expect(classifyChannel({ utm: { medium: 'sms' } })).toBe('sms');
  });

  it('helpers', () => {
    expect(referrerHost('https://www.Google.com/search?q=1')).toBe('google.com');
    expect(referrerHost('not a url at all')).toBeNull();
    expect(paidPlatform({ source: 'fb' }, null)).toBe('meta');
  });
});

describe('scrubPath / looksLikePii', () => {
  it('drops query and hash, masks capability segments and PII', () => {
    expect(scrubPath('/uz/qidiruv?q=divan#top')).toBe('/uz/qidiruv');
    expect(scrubPath('/uz/t/AbC123token')).toBe('/uz/t/:token');
    expect(scrubPath('/t/AbC123token')).toBe('/t/:token');
    expect(scrubPath('/ru/buyurtma/ord_12345')).toBe('/ru/buyurtma/:id');
    expect(scrubPath('/uz/p/+998901234567')).toBe('/uz/p/:redacted');
    expect(scrubPath('/uz/p/ali%40mail.uz')).toBe('/uz/p/:redacted');
    expect(scrubPath('/uz/p/divan-toplami')).toBe('/uz/p/divan-toplami');
    expect(scrubPath('')).toBe('/');
  });

  it('flags phones and emails, not product slugs or prices', () => {
    expect(looksLikePii('+998 90 123 45 67')).toBe(true);
    expect(looksLikePii('901234567')).toBe(true);
    expect(looksLikePii('ali@mail.uz')).toBe(true);
    expect(looksLikePii('divan kraskasi 2 l')).toBe(false);
    expect(looksLikePii('500 000')).toBe(false);
  });
});

describe('track schemas', () => {
  const base = { id: '0190f5a2-7b3c-7d4e-8f00-123456789abc', t: 1, path: '/uz' };

  it('covers every browser event and no server-only one', () => {
    expect([...BROWSER_EVENT_NAMES].sort()).toEqual([...AUTO_EVENTS, ...COMMERCE_EVENTS].sort());
    expect(
      trackEventSchema.safeParse({ ...base, name: 'purchase', props: { orderNumber: 'F-1' } })
        .success,
    ).toBe(false);
    expect(trackEventSchema.safeParse({ ...base, name: 'lead' }).success).toBe(false);
  });

  it('strips unknown props and redacts PII-looking strings', () => {
    const r = trackEventSchema.parse({
      ...base,
      name: 'search',
      props: { q: 'menga +998901234567 qo‘ng‘iroq', results: 3, phone: '+998901234567' },
    });
    expect(r.props).toEqual({ q: '[redacted]', results: 3 });
    const f = trackEventSchema.parse({
      ...base,
      name: 'form_error',
      props: { field: 'phone', value: '90 123', kind: 'required' },
    });
    expect(f.props).toEqual({ field: 'phone', kind: 'required' });
  });

  it('rejects invalid props for the name', () => {
    expect(trackEventSchema.safeParse({ ...base, name: 'add_to_cart', props: {} }).success).toBe(
      false,
    );
    expect(
      trackEventSchema.safeParse({ ...base, name: 'promo_applied', props: { code: '901234567 x' } })
        .success,
    ).toBe(false);
    expect(
      trackEventSchema.safeParse({
        ...base,
        name: 'web_vitals',
        props: { metric: 'LCP', value: 1800, rating: 'good' },
      }).success,
    ).toBe(true);
  });

  it('batch envelope limits', () => {
    const ok = { v: 1, sid: base.id, now: 2, events: [{}] };
    expect(trackBatchSchema.safeParse(ok).success).toBe(true);
    expect(trackBatchSchema.safeParse({ ...ok, events: [] }).success).toBe(false);
    expect(trackBatchSchema.safeParse({ ...ok, events: Array(51).fill({}) }).success).toBe(false);
    expect(trackBatchSchema.safeParse({ ...ok, sid: 'nope' }).success).toBe(false);
  });

  it('commerce events engage a session', () => {
    expect(isCommerceEvent('add_to_cart')).toBe(true);
    expect(isCommerceEvent('page_view')).toBe(false);
  });
});
