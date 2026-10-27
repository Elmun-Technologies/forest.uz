import { describe, expect, it } from 'vitest';
import { parseConsent } from './consent';
import {
  avgScrollPct,
  HEATMAP_INSIGHT_RULES as R,
  heatmapBin,
  heatmapDevice,
  type HeatmapElementStat,
  heatmapInsights,
  type HeatmapPageAgg,
  isCheckoutPath,
  isCtaSelector,
  normalizeHeatmapPath,
  replayReason,
  replaySampled,
} from './heatmaps';

const page = (over: Partial<HeatmapPageAgg> = {}): HeatmapPageAgg => ({
  sessions: 100,
  pageviews: 120,
  reach: { 25: 90, 50: 70, 75: 55, 100: 40 },
  scrollSum: 5400,
  clicks: 300,
  rage: 0,
  dead: 0,
  lcpCount: 0,
  lcpSlow: 0,
  lcpSumMs: 0,
  ...over,
});
const el = (selector: string, over: Partial<HeatmapElementStat> = {}): HeatmapElementStat => ({
  selector,
  label: null,
  clicks: 0,
  rage: 0,
  dead: 0,
  exits: 0,
  ...over,
});

describe('replay sampling', () => {
  const ids = Array.from(
    { length: 4000 },
    (_, i) => `0192f0e1-${String(i).padStart(4, '0')}-7abc-8def-0123456789ab`,
  );

  it('is deterministic and close to the configured rate', () => {
    const hits = ids.filter((id) => replaySampled(id, 30)).length / ids.length;
    expect(hits).toBeGreaterThan(0.26);
    expect(hits).toBeLessThan(0.34);
    for (const id of ids.slice(0, 50)) expect(replaySampled(id, 30)).toBe(replaySampled(id, 30));
  });

  it('nests: sampled at 30 % ⇒ sampled at 50 %; 0 and 100 are absolute', () => {
    for (const id of ids) if (replaySampled(id, 30)) expect(replaySampled(id, 50)).toBe(true);
    expect(ids.some((id) => replaySampled(id, 0))).toBe(false);
    expect(ids.every((id) => replaySampled(id, 100))).toBe(true);
  });

  it('reason: sample first, checkout only once checkout was reached, nothing when disabled', () => {
    const notSampled = ids.find((id) => !replaySampled(id, 30))!;
    const config = { enabled: true, samplePct: 30, checkoutPct: 100 };
    expect(replayReason({ sessionId: notSampled, config, checkout: false })).toBeNull();
    expect(replayReason({ sessionId: notSampled, config, checkout: true })).toBe('checkout');
    expect(
      replayReason({ sessionId: ids.find((id) => replaySampled(id, 30))!, config, checkout: true }),
    ).toBe('sample');
    expect(
      replayReason({
        sessionId: notSampled,
        config: { ...config, enabled: false },
        checkout: true,
      }),
    ).toBeNull();
  });

  it('recognises the checkout route in both locales', () => {
    expect(isCheckoutPath('/uz/checkout')).toBe(true);
    expect(isCheckoutPath('/ru/checkout?x=1')).toBe(true);
    expect(isCheckoutPath('/checkout')).toBe(true);
    expect(isCheckoutPath('/uz/checkouts')).toBe(false);
    expect(isCheckoutPath('/uz/savat')).toBe(false);
  });
});

describe('consent cookie', () => {
  it('replay is opt-in: absent or malformed → false', () => {
    const enc = (v: unknown) => encodeURIComponent(JSON.stringify(v));
    expect(parseConsent(enc({ v: 1, analytics: true, marketing: false, ts: 1 }))?.replay).toBe(
      false,
    );
    expect(
      parseConsent(enc({ v: 1, analytics: true, marketing: false, replay: true, ts: 1 }))?.replay,
    ).toBe(true);
    expect(
      parseConsent(enc({ v: 1, analytics: true, marketing: false, replay: 'yes' }))?.replay,
    ).toBe(false);
    expect(parseConsent('not json')).toBeNull();
    expect(parseConsent(enc({ v: 2, analytics: true, marketing: true }))).toBeNull();
  });
});

describe('heatmap math', () => {
  it('normalizes paths like the SQL aggregation', () => {
    expect(normalizeHeatmapPath('/uz')).toBe('/');
    expect(normalizeHeatmapPath('/ru/')).toBe('/');
    expect(normalizeHeatmapPath('/uz/katalog?page=2#top')).toBe('/katalog');
    expect(normalizeHeatmapPath('/uz/p/divan-toplami/')).toBe('/p/divan-toplami');
    expect(normalizeHeatmapPath('/uzbek-style')).toBe('/uzbek-style');
    expect(normalizeHeatmapPath('/')).toBe('/');
  });

  it('bins x ‰ and y px, clamping x to the last column', () => {
    expect(heatmapBin(0, 20, 1000)).toBe(0);
    expect(heatmapBin(519, 20, 1000)).toBe(500);
    expect(heatmapBin(1000, 20, 1000)).toBe(980);
    expect(heatmapBin(1347, 20)).toBe(1340);
    expect(heatmapBin(-5, 20)).toBe(0);
  });

  it('classifies devices by viewport width, else the UA class', () => {
    expect(heatmapDevice(390)).toBe('mobile');
    expect(heatmapDevice(767)).toBe('mobile');
    expect(heatmapDevice(768)).toBe('desktop');
    expect(heatmapDevice(null, 'mobile')).toBe('mobile');
    expect(heatmapDevice(undefined, 'tablet')).toBe('desktop');
  });

  it('average scroll = Σ max depth / sessions', () => {
    expect(avgScrollPct(page())).toBe(54);
    expect(avgScrollPct(page({ sessions: 0 }))).toBeNull();
    expect(avgScrollPct(null)).toBeNull();
  });

  it('CTA selectors are links/buttons (last step) or data-cta', () => {
    expect(isCtaSelector('main>section:nth-of-type(2)>a')).toBe(true);
    expect(isCtaSelector('#hero>button:nth-of-type(1)')).toBe(true);
    expect(isCtaSelector('main>div>img')).toBe(false);
    expect(isCtaSelector('div[data-cta=prices]')).toBe(true);
  });
});

describe('heatmap insights', () => {
  it('reports nothing below the minimum sessions', () => {
    const small = page({ sessions: R.minSessions - 1, dead: 50 });
    expect(
      heatmapInsights({
        page: small,
        mobile: small,
        elements: [el('a', { clicks: 50, dead: 50 })],
      }),
    ).toEqual([]);
  });

  it('dead clicks: count and share thresholds, top N by count', () => {
    const elements = [
      el('main>img', { clicks: 20, dead: 30 }),
      el('main>p', { clicks: 100, dead: 12 }), // share 12 % < 30 %
      el('main>span', { clicks: 5, dead: R.deadClicks.minCount - 1 }),
    ];
    const out = heatmapInsights({ page: page(), mobile: null, elements });
    expect(out).toEqual([
      {
        kind: 'dead_clicks',
        severity: 'high',
        selector: 'main>img',
        label: null,
        dead: 30,
        sharePct: 100,
      },
    ]);
  });

  it('rage hotspots and exits after a CTA', () => {
    const elements = [
      el('main>button', { clicks: 40, exits: 14, rage: 6, label: 'Narxlar' }),
      el('main>div', { clicks: 40, exits: 30 }), // not a CTA
      el('main>a', { clicks: R.exitAfterCta.minClicks - 1, exits: 19 }),
    ];
    const out = heatmapInsights({ page: page(), mobile: null, elements });
    expect(out).toContainEqual({
      kind: 'exit_after_cta',
      severity: 'high',
      selector: 'main>button',
      label: 'Narxlar',
      exitPct: 35,
      clicks: 40,
    });
    expect(out).toContainEqual({
      kind: 'rage_hotspot',
      severity: 'medium',
      selector: 'main>button',
      label: 'Narxlar',
      rage: 6,
    });
    expect(out.filter((i) => i.kind === 'exit_after_cta')).toHaveLength(1);
  });

  it('slow LCP = more than 25 % of samples over 2.5 s (p75 rule)', () => {
    const at = (slow: number) =>
      heatmapInsights({
        page: page({ lcpCount: 40, lcpSlow: slow, lcpSumMs: 40 * 2600 }),
        mobile: null,
        elements: [],
      });
    expect(at(10)).toEqual([]); // exactly 25 %
    expect(at(11)).toEqual([
      { kind: 'slow_lcp', severity: 'medium', slowPct: 28, avgMs: 2600, samples: 40 },
    ]);
    expect(
      heatmapInsights({ page: page({ lcpCount: 10, lcpSlow: 10 }), mobile: null, elements: [] }),
    ).toEqual([]); // too few samples
  });

  it('mobile reach: the first depth fewer than half reach', () => {
    const mobile = page({ reach: { 25: 80, 50: 58, 75: 42, 100: 20 } });
    expect(heatmapInsights({ page: page(), mobile, elements: [] })).toEqual([
      { kind: 'mobile_reach', severity: 'medium', depth: 75, notReachedPct: 58, sessions: 100 },
    ]);
    const fine = page({ reach: { 25: 95, 50: 90, 75: 80, 100: 30 } });
    expect(heatmapInsights({ page: page(), mobile: fine, elements: [] })).toEqual([]);
  });
});
