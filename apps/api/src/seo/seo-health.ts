import {
  type CwvMetric,
  type CwvRating,
  type Locale,
  SEO_DESCRIPTION_MAX,
  SEO_DESCRIPTION_MIN,
  SEO_TITLE_MAX,
  SEO_TITLE_MIN,
  type AdminSeoHealthDto,
  type SeoIssueDto,
  type SeoRule,
  type SeoSeverity,
} from '@forest/contracts';

/** One page × locale with its effective (override or template) meta. */
export interface HealthPage {
  path: string;
  locale: Locale;
  title: string;
  description: string;
  noindex: boolean;
  /** Canonical override pointing at another URL. */
  canonicalForeign: boolean;
  imagesWithoutAlt: number;
}

export interface HealthInput {
  pages: HealthPage[];
  /** Broken internal links: 404 paths referred by our own site, redirects to dead targets. */
  brokenLinks: { path: string; detail: string }[];
  /** Site-wide field CWV p75 (null rating = not enough data). */
  cwv: { metric: CwvMetric; p75: number | null; rating: CwvRating | null }[];
}

export const RULE_SEVERITY: Record<SeoRule, SeoSeverity> = {
  title_missing: 'critical',
  description_missing: 'critical',
  noindex_in_sitemap: 'critical',
  broken_link: 'critical',
  cwv_poor: 'critical',
  canonical_foreign: 'warning',
  title_duplicate: 'warning',
  description_duplicate: 'warning',
  title_length: 'warning',
  description_length: 'warning',
  alt_missing: 'warning',
  cwv_needs_improvement: 'warning',
};

const WEIGHT: Record<SeoSeverity, number> = { critical: 15, warning: 4 };
const MAX_EXAMPLES = 20;

export interface HealthResult extends AdminSeoHealthDto {
  /** `${locale}:${path}` → rules failing on that page. */
  byPage: Map<string, SeoRule[]>;
}

export const pageKey = (locale: Locale, path: string) => `${locale}:${path}`;

/**
 * SEO health (CLAUDE.md §6): page rules over the inventory + site rules (broken links, CWV).
 * Score = 100 − Σ weight(severity) × max(⅓, affected share) per failing rule, clamped 0..100.
 */
export function seoHealth(input: HealthInput): HealthResult {
  const byRule = new Map<SeoRule, SeoIssueDto['examples']>();
  const byPage = new Map<string, SeoRule[]>();
  const flag = (rule: SeoRule, page: HealthPage, detail: string | null = null) => {
    const list = byRule.get(rule) ?? [];
    list.push({ path: page.path, locale: page.locale, detail });
    byRule.set(rule, list);
    const key = pageKey(page.locale, page.path);
    byPage.set(key, [...(byPage.get(key) ?? []), rule]);
  };

  const dupes = (field: 'title' | 'description') => {
    const groups = new Map<string, HealthPage[]>();
    for (const p of input.pages) {
      const v = p[field].trim().toLowerCase();
      if (!v) continue;
      const k = `${p.locale}\u0000${v}`;
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    return new Set([...groups.values()].filter((g) => g.length > 1).flat());
  };
  const dupTitles = dupes('title');
  const dupDescriptions = dupes('description');

  for (const p of input.pages) {
    const title = p.title.trim();
    const description = p.description.trim();
    if (!title) flag('title_missing', p);
    else if (title.length < SEO_TITLE_MIN || title.length > SEO_TITLE_MAX)
      flag('title_length', p, `${title.length}`);
    if (!description) flag('description_missing', p);
    else if (description.length < SEO_DESCRIPTION_MIN || description.length > SEO_DESCRIPTION_MAX)
      flag('description_length', p, `${description.length}`);
    if (p.noindex) flag('noindex_in_sitemap', p);
    if (p.canonicalForeign) flag('canonical_foreign', p);
    if (dupTitles.has(p)) flag('title_duplicate', p);
    if (dupDescriptions.has(p)) flag('description_duplicate', p);
    if (p.imagesWithoutAlt > 0) flag('alt_missing', p, `${p.imagesWithoutAlt}`);
  }

  const site = new Map<SeoRule, SeoIssueDto['examples']>();
  if (input.brokenLinks.length)
    site.set(
      'broken_link',
      input.brokenLinks.map((b) => ({ path: b.path, locale: null, detail: b.detail })),
    );
  for (const m of input.cwv) {
    const rule: SeoRule | null =
      m.rating === 'poor'
        ? 'cwv_poor'
        : m.rating === 'needs-improvement'
          ? 'cwv_needs_improvement'
          : null;
    if (!rule) continue;
    site.set(rule, [
      ...(site.get(rule) ?? []),
      { path: m.metric, locale: null, detail: `${m.p75}` },
    ]);
  }

  const total = Math.max(1, input.pages.length);
  let penalty = 0;
  const issues: SeoIssueDto[] = [];
  for (const [rule, examples] of [...byRule, ...site]) {
    const severity = RULE_SEVERITY[rule];
    const share =
      rule === 'broken_link'
        ? Math.min(1, examples.length / 10)
        : rule.startsWith('cwv_')
          ? examples.length / 3
          : examples.length / total;
    penalty += WEIGHT[severity] * Math.max(1 / 3, Math.min(1, share));
    issues.push({
      rule,
      severity,
      count: examples.length,
      examples: examples.slice(0, MAX_EXAMPLES),
    });
  }
  issues.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1) || b.count - a.count,
  );
  const sum = (s: SeoSeverity) =>
    issues.filter((i) => i.severity === s).reduce((n, i) => n + i.count, 0);
  return {
    score: Math.max(0, Math.min(100, Math.round(100 - penalty))),
    critical: sum('critical'),
    warnings: sum('warning'),
    pages: input.pages.length,
    issues,
    byPage,
  };
}
