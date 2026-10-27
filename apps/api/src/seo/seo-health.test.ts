import { describe, expect, it } from 'vitest';
import { type HealthPage, seoHealth } from './seo-health';

const page = (over: Partial<HealthPage> = {}): HealthPage => ({
  path: '/p/a',
  locale: 'uz',
  title: 'Chalk White — narxi, sotib olish | Forest',
  description: 'x'.repeat(120),
  noindex: false,
  canonicalForeign: false,
  imagesWithoutAlt: 0,
  ...over,
});

describe('seoHealth', () => {
  it('scores a clean site 100 with no issues', () => {
    const r = seoHealth({
      pages: [
        page(),
        page({
          path: '/p/b',
          title: 'Boshqa mahsulot nomi — narxi | Forest',
          description: 'y'.repeat(100),
        }),
      ],
      brokenLinks: [],
      cwv: [],
    });
    expect(r).toMatchObject({ score: 100, critical: 0, warnings: 0, pages: 2, issues: [] });
  });

  it('flags missing, long and duplicate meta per page', () => {
    const r = seoHealth({
      pages: [
        page({ title: '' }),
        page({ path: '/p/b', title: 'a'.repeat(70) }),
        page({ path: '/p/c', description: 'x'.repeat(120) }),
        page({ path: '/p/d', locale: 'ru', description: 'short' }),
      ],
      brokenLinks: [],
      cwv: [],
    });
    const rules = Object.fromEntries(r.issues.map((i) => [i.rule, i.count]));
    expect(rules).toMatchObject({ title_missing: 1, title_length: 1, description_length: 1 });
    // uz pages a, b, c share the description; the ru page is another locale.
    expect(rules.description_duplicate).toBe(3);
    expect(r.byPage.get('uz:/p/a')).toEqual(['title_missing', 'description_duplicate']);
    expect(r.issues[0]!.severity).toBe('critical');
  });

  it('treats noindex, broken links and poor CWV as critical, alt/canonical/NI as warnings', () => {
    const r = seoHealth({
      pages: [
        page({ noindex: true }),
        page({
          path: '/p/b',
          title: 'Second product title is fine | Forest',
          description: 'z'.repeat(90),
          canonicalForeign: true,
          imagesWithoutAlt: 2,
        }),
      ],
      brokenLinks: [{ path: '/uz/p/old', detail: '← http://localhost:3000/uz' }],
      cwv: [
        { metric: 'LCP', p75: 4500, rating: 'poor' },
        { metric: 'CLS', p75: 0.14, rating: 'needs-improvement' },
        { metric: 'INP', p75: 120, rating: 'good' },
      ],
    });
    const sev = Object.fromEntries(r.issues.map((i) => [i.rule, i.severity]));
    expect(sev).toEqual({
      noindex_in_sitemap: 'critical',
      broken_link: 'critical',
      cwv_poor: 'critical',
      canonical_foreign: 'warning',
      alt_missing: 'warning',
      cwv_needs_improvement: 'warning',
    });
    expect(r.critical).toBe(3);
    // 3 critical rules × max(⅓, share) × 15 + 3 warnings × max(⅓, share) × 4
    // noindex share ½ → 7.5; broken 1/10 → ⅓ → 5; LCP 1/3 → 5; canonical ½ → 2; alt ½ → 2; CLS ⅓ → 1.33
    expect(r.score).toBe(Math.round(100 - (7.5 + 5 + 5 + 2 + 2 + 4 / 3)));
  });

  it('a site failing every rule scores low (clamped to 0..100)', () => {
    const pages = Array.from({ length: 5 }, (_, i) =>
      page({
        path: `/p/${i}`,
        title: '',
        description: '',
        noindex: true,
        canonicalForeign: true,
        imagesWithoutAlt: 1,
      }),
    );
    const r = seoHealth({
      pages,
      brokenLinks: Array.from({ length: 20 }, (_, i) => ({ path: `/x${i}`, detail: '' })),
      cwv: [
        { metric: 'LCP', p75: 9000, rating: 'poor' },
        { metric: 'INP', p75: 900, rating: 'poor' },
        { metric: 'CLS', p75: 0.9, rating: 'poor' },
      ],
    });
    // 5 critical rules at full share (75) + canonical and alt warnings (8).
    expect(r.score).toBe(17);
  });
});
