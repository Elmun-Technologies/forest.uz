import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminCwvDto,
  type AdminNotFoundDto,
  type AdminRedirectDto,
  type AdminRedirectPageDto,
  type AdminSearchQueriesDto,
  type AdminSeoOverviewDto,
  type AdminSeoPageDto,
  type AdminSeoPagesDto,
  type AdminZeroResultDto,
  DomainError,
  LOCALES,
  type Locale,
  parseVerificationCode,
  type PageSpeedRunDto,
  type RedirectInput,
  type SeoMetaInput,
  type SeoSchemaToggles,
  seoTemplate,
  type SettingKey,
  type SettingValue,
  settingSchemas,
  type VerificationInput,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { saveRedirect } from '../../customer/seo/redirects';
import { normalizePath } from '../../customer/seo/seo-paths';
import { FilesService } from '../../files/files.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { isPublicSite } from '../../integrations/providers/seo-tools';
import { PrismaService } from '../../prisma/prisma.service';
import { closestPath } from '../../seo/closest-path';
import { CwvService } from '../../seo/cwv.service';
import { IndexNowService } from '../../seo/indexnow.service';
import { defaultRobots, normalizeRobots } from '../../seo/robots';
import { type SearchSource, SearchQueriesService } from '../../seo/search-queries.service';
import { SeoEventsService } from '../../seo/seo-events.service';
import { pageKey, seoHealth, type HealthResult } from '../../seo/seo-health';
import { type InventoryPage, SeoInventoryService } from '../../seo/seo-inventory.service';
import { isSelfCanonical, SitemapService, siteBase } from '../../seo/sitemap.service';
import { SettingsService } from '../../settings/settings.service';
import { type AuditActor, AuditService } from '../audit/audit.service';

type Tx = Prisma.TransactionClient;
const DAY_MS = 86_400_000;

interface Analysis {
  inventory: InventoryPage[];
  pages: AdminSeoPageDto[];
  health: HealthResult;
  live: Set<string>;
}

/** Admin A9 SEO center (docs/10, CLAUDE.md §6). Every mutation is audited in its transaction. */
@Injectable()
export class AdminSeoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly inventory: SeoInventoryService,
    private readonly sitemap: SitemapService,
    private readonly indexNow: IndexNowService,
    private readonly queriesSvc: SearchQueriesService,
    private readonly cwvSvc: CwvService,
    private readonly events: SeoEventsService,
    private readonly files: FilesService,
    private readonly integrations: IntegrationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get site(): string {
    return siteBase(this.env);
  }

  private get siteHost(): string | null {
    try {
      return new URL(this.env.APP_URL).host;
    } catch {
      return null;
    }
  }

  // ───────── analysis (health + page list) ─────────

  private async analyse(): Promise<Analysis> {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [inventory, metas, redirects, notFound, cwv] = await Promise.all([
      this.inventory.pages(),
      this.prisma.seoMeta.findMany(),
      this.prisma.redirect.findMany({ select: { from: true, to: true } }),
      this.prisma.notFoundLog.findMany({
        where: { lastSeen: { gte: since }, referrer: { not: null } },
        orderBy: { hits: 'desc' },
        take: 200,
      }),
      this.cwvSvc.field(28),
    ]);
    const live = SeoInventoryService.livePaths(inventory);
    const fileIds = [...new Set(metas.map((m) => m.ogImageId).filter((x): x is string => !!x))];
    const ogFiles = new Map(
      (await this.prisma.file.findMany({ where: { id: { in: fileIds } } })).map((f) => [f.id, f]),
    );
    const metaOf = new Map(metas.map((m) => [pageKey(m.locale as Locale, m.path), m]));

    const pages: AdminSeoPageDto[] = [];
    const healthPages = [];
    for (const p of inventory) {
      for (const locale of p.locales) {
        const template = seoTemplate(p.kind, locale, p.vars[locale]);
        const m = metaOf.get(pageKey(locale, p.path));
        const self = `/${locale}${p.path === '/' ? '' : p.path}`;
        const canonical = m?.canonical ?? null;
        const foreign = !!canonical && !isSelfCanonical(canonical, self, this.site);
        const og = m?.ogImageId ? ogFiles.get(m.ogImageId) : undefined;
        const imagesWithoutAlt = p.product?.images.filter((i) => !i.alt[locale]).length ?? 0;
        const effective = {
          title: m?.title.trim() || template.title,
          description: m?.description.trim() || template.description,
          noindex: m?.noindex ?? false,
          canonical: canonical
            ? canonical.startsWith('/')
              ? `${this.site}${canonical}`
              : canonical
            : `${this.site}${self}`,
        };
        healthPages.push({
          path: p.path,
          locale,
          title: effective.title,
          description: effective.description,
          noindex: effective.noindex,
          canonicalForeign: foreign,
          imagesWithoutAlt,
        });
        pages.push({
          path: p.path,
          kind: p.kind,
          locale,
          label: p.label[locale],
          url: `${this.site}${self}`,
          template,
          override: m
            ? {
                title: m.title,
                description: m.description,
                ogImageId: m.ogImageId,
                ogImageUrl: og?.isPublic ? this.files.publicUrl(og.key) : null,
                noindex: m.noindex,
                canonical: m.canonical,
                updatedAt: m.updatedAt.toISOString(),
              }
            : null,
          effective,
          rich: p.product
            ? {
                priceFromSoum: p.product.priceFromSoum,
                inStock: p.product.inStock,
                rating: p.product.rating,
              }
            : null,
          imagesWithoutAlt,
          images: p.product?.images.map((i) => ({ fileId: i.fileId, url: i.url })) ?? [],
          issues: [],
        });
      }
    }

    const host = this.siteHost;
    const brokenLinks = [
      ...notFound
        .filter((n) => {
          try {
            return !!n.referrer && new URL(n.referrer).host === host;
          } catch {
            return false;
          }
        })
        .map((n) => ({ path: n.path, detail: `← ${n.referrer}` })),
      ...redirects
        .filter((r) => !live.has(r.to.replace(/\/+$/, '') || '/'))
        .map((r) => ({ path: r.to, detail: `redirect ${r.from}` })),
    ];
    const health = seoHealth({ pages: healthPages, brokenLinks, cwv: cwv.metrics });
    for (const page of pages) {
      const rules = health.byPage.get(pageKey(page.locale, page.path)) ?? [];
      page.issues = rules.map((rule) => ({
        rule,
        severity: health.issues.find((i) => i.rule === rule)?.severity ?? 'warning',
      }));
    }
    return { inventory, pages, health, live };
  }

  async overview(): Promise<AdminSeoOverviewDto> {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [
      analysis,
      verification,
      robots,
      schema,
      indexnow,
      status,
      pending,
      lastPing,
      redirects,
      nf,
      gsc,
      ywm,
      psi,
    ] = await Promise.all([
      this.analyse(),
      this.settings.get('seo.verification'),
      this.settings.get('seo.robots'),
      this.settings.get('seo.schema'),
      this.settings.get('seo.indexnow'),
      this.sitemap.status(),
      this.indexNow.pending(),
      this.indexNow.lastPing(),
      this.prisma.redirect.count(),
      this.prisma.notFoundLog.aggregate({
        where: { lastSeen: { gte: since } },
        _count: true,
        _sum: { hits: true },
      }),
      this.queriesSvc.state('gsc'),
      this.queriesSvc.state('ywm'),
      this.prisma.integration.findUnique({ where: { key: 'pagespeed' }, select: { status: true } }),
    ]);
    const faqPages = await this.prisma.page.count({ where: { kind: 'FAQ', published: true } });
    const defaultText = defaultRobots(this.site);
    const { byPage: _byPage, ...health } = analysis.health;
    return {
      siteUrl: this.site,
      usingFake: this.integrations.fakeMode,
      health,
      verification,
      robots: {
        custom: robots.custom,
        effective: robots.custom?.trim() ? normalizeRobots(robots.custom) : defaultText,
        defaultText,
      },
      schema,
      faqPages: faqPages > 0 ? 1 : 0,
      sitemap: {
        url: `${this.site}/sitemap.xml`,
        generatedAt: status?.generatedAt ?? null,
        urls: status?.urls ?? 0,
        reason: status?.reason ?? null,
        files: status?.files ?? [],
      },
      indexNow: {
        enabled: indexnow.enabled,
        keyFileUrl: `${this.site}/${indexnow.key}.txt`,
        publicHost: isPublicSite(this.site),
        pending,
        lastPing,
      },
      redirects,
      notFound7d: { paths: nf._count, hits: nf._sum.hits ?? 0 },
      sources: {
        gsc,
        ywm,
        pagespeed: {
          status: (psi?.status ??
            'DISCONNECTED') as AdminSeoOverviewDto['sources']['pagespeed']['status'],
          lastSyncedAt: null,
        },
      },
    };
  }

  async pages(): Promise<AdminSeoPagesDto> {
    const { pages } = await this.analyse();
    return { siteUrl: this.site, items: pages };
  }

  // ───────── per-page meta ─────────

  /**
   * `canExternal` = the actor holds `seo.canonical_external` (Owner/Manager): a canonical to
   * another host moves the page's ranking away, so Marketers may only keep an existing one.
   */
  async saveMeta(
    actor: AuditActor,
    input: SeoMetaInput,
    canExternal: boolean,
  ): Promise<AdminSeoPageDto> {
    const inventory = await this.inventory.pages();
    const page = inventory.find((p) => p.path === input.path && p.locales.includes(input.locale));
    if (!page) throw new DomainError('SEO_PAGE_UNKNOWN', undefined, 'path');
    const canonical = input.canonical ? this.canonical(input.canonical) : null;
    if (canonical && !canonical.startsWith('/') && !canExternal) {
      const current = await this.prisma.seoMeta.findUnique({
        where: { path_locale: { path: input.path, locale: input.locale } },
        select: { canonical: true },
      });
      if (current?.canonical !== canonical)
        throw new DomainError('SEO_CANONICAL_EXTERNAL_FORBIDDEN', undefined, 'canonical');
    }
    if (input.ogImageId) {
      const file = await this.prisma.file.findUnique({ where: { id: input.ogImageId } });
      if (!file?.isPublic || !/^image\//.test(file.mime))
        throw new DomainError('SEO_OG_IMAGE_INVALID', undefined, 'ogImageId');
    }
    const blank =
      !input.title && !input.description && !input.ogImageId && !input.noindex && !canonical;
    await this.prisma.$transaction(async (tx) => {
      const where = { path_locale: { path: input.path, locale: input.locale } };
      const before = await tx.seoMeta.findUnique({ where });
      const data = {
        title: input.title,
        description: input.description,
        ogImageId: input.ogImageId,
        noindex: input.noindex,
        canonical,
      };
      if (blank) {
        if (before) await tx.seoMeta.delete({ where });
      } else
        await tx.seoMeta.upsert({
          where,
          create: { path: input.path, locale: input.locale, ...data },
          update: data,
        });
      await this.audit.record(
        actor,
        {
          action: blank ? 'seo.meta_reset' : 'seo.meta_update',
          entity: 'SeoMeta',
          entityId: `${input.locale}:${input.path}`,
          before: before ? pick(before) : null,
          after: blank ? null : data,
        },
        tx,
      );
    });
    void this.events.pageMetaChanged(input.path);
    const { pages } = await this.analyse();
    return pages.find((p) => p.path === input.path && p.locale === input.locale)!;
  }

  /**
   * Same-site path (`/uz/…`; an https URL on our own host is stored as its path) or an https URL
   * on another host. `http://` is refused everywhere — a canonical must never downgrade.
   */
  private canonical(input: string): string {
    const invalid = () => new DomainError('SEO_CANONICAL_INVALID', undefined, 'canonical');
    if (input.startsWith('/')) {
      const path = normalizePath(input);
      if (!path) throw invalid();
      return path;
    }
    let u: URL;
    try {
      u = new URL(input);
    } catch {
      throw invalid();
    }
    if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password)
      throw invalid();
    if (u.host === this.siteHost) {
      const path = normalizePath(u.pathname);
      if (!path) throw invalid();
      return path;
    }
    return u.toString();
  }

  // ───────── redirects & 404 ─────────

  async redirects(q: {
    q?: string;
    cursor?: string;
    limit: number;
  }): Promise<AdminRedirectPageDto> {
    const where: Prisma.RedirectWhereInput = q.q
      ? { OR: [{ from: { contains: q.q } }, { to: { contains: q.q } }] }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.redirect.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      this.prisma.redirect.count({ where }),
    ]);
    const items = rows.slice(0, q.limit).map(redirectDto);
    return { items, total, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
  }

  async saveRedirect(
    actor: AuditActor,
    input: RedirectInput,
    id?: string,
  ): Promise<AdminRedirectDto> {
    const live = SeoInventoryService.livePaths(await this.inventory.pages());
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const before = id ? await tx.redirect.findUnique({ where: { id } }) : null;
        if (id && !before) throw new DomainError('NOT_FOUND');
        const saved = await saveRedirect(tx, input, { siteHost: this.siteHost, id, live });
        await this.audit.record(
          actor,
          {
            action: id ? 'seo.redirect_update' : 'seo.redirect_create',
            entity: 'Redirect',
            entityId: saved.id,
            before: before ? { from: before.from, to: before.to, code: before.code } : null,
            after: { from: saved.from, to: saved.to, code: saved.code },
          },
          tx,
        );
        return saved;
      });
      return redirectDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new DomainError('VALIDATION_FAILED', undefined, 'from');
      throw e;
    }
  }

  async deleteRedirect(actor: AuditActor, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.redirect.findUnique({ where: { id } });
      if (!row) throw new DomainError('NOT_FOUND');
      await tx.redirect.delete({ where: { id } });
      await this.audit.record(
        actor,
        {
          action: 'seo.redirect_delete',
          entity: 'Redirect',
          entityId: id,
          before: { from: row.from, to: row.to, code: row.code, hits: row.hits },
        },
        tx,
      );
    });
  }

  async notFound(days: number): Promise<AdminNotFoundDto[]> {
    const since = new Date(Date.now() - days * DAY_MS);
    const [rows, inventory] = await Promise.all([
      this.prisma.notFoundLog.findMany({
        where: { lastSeen: { gte: since } },
        orderBy: [{ hits: 'desc' }, { lastSeen: 'desc' }],
        take: 200,
      }),
      this.inventory.pages(),
    ]);
    const live = SeoInventoryService.livePaths(inventory);
    // Suggest only real pages, not private routes (cart, cabinet…).
    const targets = [...live].filter(
      (p) => !/\/(savat|checkout|kabinet|buyurtma|kirish|fake-pay|qidiruv)$/.test(p),
    );
    const host = this.siteHost;
    return rows.map((r) => {
      let internal = false;
      try {
        internal = !!r.referrer && new URL(r.referrer).host === host;
      } catch {
        internal = false;
      }
      return {
        path: r.path,
        hits: r.hits,
        lastSeen: r.lastSeen.toISOString(),
        referrer: r.referrer,
        internal,
        suggestion: closestPath(r.path, targets),
      };
    });
  }

  async dismissNotFound(actor: AuditActor, path: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.notFoundLog.findUnique({ where: { path } });
      if (!row) throw new DomainError('NOT_FOUND');
      await tx.notFoundLog.delete({ where: { path } });
      await this.audit.record(
        actor,
        {
          action: 'seo.not_found_dismiss',
          entity: 'NotFoundLog',
          entityId: path,
          before: { hits: row.hits },
        },
        tx,
      );
    });
  }

  // ───────── site settings ─────────

  private async saveSetting<K extends SettingKey>(
    actor: AuditActor,
    key: K,
    value: SettingValue<K>,
    tags: ('settings' | 'seo')[],
  ): Promise<void> {
    const parsed = settingSchemas[key].parse(value) as object;
    await this.prisma.$transaction(async (tx: Tx) => {
      const before = await tx.setting.findUnique({ where: { key } });
      await tx.setting.upsert({
        where: { key },
        update: { value: parsed, updatedBy: actor.staffId },
        create: { key, value: parsed, updatedBy: actor.staffId },
      });
      await this.audit.record(
        actor,
        {
          action: `settings.${key}.update`,
          entity: 'Setting',
          entityId: key,
          before: before?.value ?? null,
          after: parsed,
        },
        tx,
      );
    });
    this.settings.invalidate();
    if (tags.length) this.events.settingsChanged(tags);
  }

  async saveVerification(actor: AuditActor, input: VerificationInput) {
    const out: Record<'google' | 'yandex' | 'bing', string | null> = {
      google: null,
      yandex: null,
      bing: null,
    };
    for (const k of ['google', 'yandex', 'bing'] as const) {
      const code = parseVerificationCode(input[k]);
      if (code === false) throw new DomainError('SEO_VERIFICATION_INVALID', undefined, k);
      out[k] = code;
    }
    await this.saveSetting(actor, 'seo.verification', out, ['settings', 'seo']);
    return out;
  }

  async saveRobots(actor: AuditActor, custom: string | null) {
    const text = custom?.trim() ? normalizeRobots(custom) : null;
    await this.saveSetting(actor, 'seo.robots', { custom: text }, []);
    return {
      custom: text,
      effective: text ?? defaultRobots(this.site),
      defaultText: defaultRobots(this.site),
    };
  }

  async saveSchema(actor: AuditActor, toggles: SeoSchemaToggles): Promise<SeoSchemaToggles> {
    await this.saveSetting(actor, 'seo.schema', toggles, ['seo']);
    return toggles;
  }

  async saveIndexNow(actor: AuditActor, enabled: boolean) {
    const current = await this.settings.get('seo.indexnow');
    await this.saveSetting(actor, 'seo.indexnow', { ...current, enabled }, []);
    return { enabled };
  }

  // ───────── actions ─────────

  async regenerateSitemap(actor: AuditActor) {
    const status = await this.sitemap.regenerate('admin');
    await this.audit.record(actor, {
      action: 'seo.sitemap_regenerate',
      entity: 'Sitemap',
      after: { urls: status.urls },
    });
    return status;
  }

  /** Queue every live page for IndexNow (e.g. after go-live). */
  async submitAll(actor: AuditActor): Promise<{ queued: number }> {
    const inventory = await this.inventory.pages();
    await this.indexNow.enqueue(inventory.map((p) => p.path));
    const queued = await this.indexNow.pending();
    await this.audit.record(actor, {
      action: 'seo.indexnow_submit_all',
      entity: 'IndexNow',
      after: { queued },
    });
    return { queued };
  }

  queries(source: SearchSource, days: number): Promise<AdminSearchQueriesDto> {
    return this.queriesSvc.report(source, days);
  }

  async syncQueries(actor: AuditActor) {
    const result = await this.queriesSvc.sync();
    await this.audit.record(actor, {
      action: 'seo.queries_sync',
      entity: 'SearchQueryDaily',
      after: { result },
    });
    return result;
  }

  async cwv(): Promise<AdminCwvDto> {
    const [field, lab] = await Promise.all([this.cwvSvc.field(28), this.cwvSvc.lab()]);
    return { ...field, lab };
  }

  async runPageSpeed(
    actor: AuditActor,
    path: string,
    strategy: 'mobile' | 'desktop',
  ): Promise<PageSpeedRunDto | null> {
    const url = `${this.site}${path}`;
    const run = await this.cwvSvc.runLab(url, strategy, actor.staffId ?? '');
    await this.audit.record(actor, {
      action: 'seo.pagespeed_run',
      entity: 'PageSpeedRun',
      entityId: run?.id ?? null,
      after: { url, strategy, score: run?.score ?? null },
    });
    return run;
  }

  async zeroResults(days = 30): Promise<AdminZeroResultDto[]> {
    const since = new Date(Date.now() - days * DAY_MS);
    const rows = await this.prisma.$queryRaw<
      { query: string; locale: Locale; searches: bigint; last: Date }[]
    >`
      SELECT lower(trim("query")) AS query, "locale"::text AS locale, COUNT(*)::bigint AS searches, MAX("createdAt") AS last
      FROM "SearchQueryLog"
      WHERE "results" = 0 AND "createdAt" >= ${since} AND length(trim("query")) > 0
      GROUP BY lower(trim("query")), "locale"
      ORDER BY searches DESC, last DESC
      LIMIT 50`;
    return rows.map((r) => ({
      query: r.query,
      locale: LOCALES.includes(r.locale) ? r.locale : 'uz',
      searches: Number(r.searches),
      lastAt: r.last.toISOString(),
    }));
  }
}

function pick(m: {
  title: string;
  description: string;
  ogImageId: string | null;
  noindex: boolean;
  canonical: string | null;
}) {
  return {
    title: m.title,
    description: m.description,
    ogImageId: m.ogImageId,
    noindex: m.noindex,
    canonical: m.canonical,
  };
}

function redirectDto(r: {
  id: string;
  from: string;
  to: string;
  code: number;
  hits: number;
  lastHitAt: Date | null;
  createdAt: Date;
}): AdminRedirectDto {
  return {
    id: r.id,
    from: r.from,
    to: r.to,
    code: r.code,
    hits: r.hits,
    lastHitAt: r.lastHitAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
