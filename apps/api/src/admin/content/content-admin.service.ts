import { Injectable, Logger } from '@nestjs/common';
import {
  type AdminArticleDto,
  type AdminArticleListDto,
  type AdminArticleRowDto,
  type AdminPageLocaleDto,
  type AdminUploadedImageDto,
  type ArticleSaveInput,
  articlePath,
  BRAND_PAGE_SLUG,
  CMS_ARTICLE_KIND,
  CMS_PAGE_KIND,
  type CmsLocaleInput,
  DomainError,
  isArticleCategory,
  LOCALES,
  type Locale,
} from '@forest/contracts';
import type { Page, Prisma } from '@forest/db';
import { blockFileIds, pageBlocks, pageData } from '../../cms/page-data';
import { saveRedirect } from '../../customer/seo/redirects';
import { FilesService } from '../../files/files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IndexNowService } from '../../seo/indexnow.service';
import { SitemapService } from '../../seo/sitemap.service';
import { WebRevalidateService } from '../../seo/web-revalidate.service';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AdminUploadService, type UploadedImage } from '../files/upload.service';

type Kind = typeof CMS_ARTICLE_KIND | typeof CMS_PAGE_KIND;
type Tx = Prisma.TransactionClient;

/** Locale-less storefront path of a CMS document. */
const pathOf = (kind: Kind, slug: string) =>
  kind === CMS_PAGE_KIND ? `/${slug}` : articlePath(slug);

/**
 * Admin CMS for Ilhom articles and the Brend story (CLAUDE.md §6). One save = the whole document
 * (both locales, SEO, data) in one transaction with its audit row; after commit the storefront
 * cache, sitemap and IndexNow are told.
 */
@Injectable()
export class ContentAdminService {
  private readonly logger = new Logger('ContentAdmin');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly uploads: AdminUploadService,
    private readonly files: FilesService,
    private readonly web: WebRevalidateService,
    private readonly sitemap: SitemapService,
    private readonly indexNow: IndexNowService,
  ) {}

  async list(): Promise<AdminArticleListDto> {
    const rows = await this.prisma.page.findMany({
      where: { kind: { in: [CMS_ARTICLE_KIND, CMS_PAGE_KIND] } },
      orderBy: [{ kind: 'asc' }, { slug: 'asc' }],
    });
    const groups = new Map<string, Page[]>();
    for (const r of rows)
      groups.set(`${r.kind}/${r.slug}`, [...(groups.get(`${r.kind}/${r.slug}`) ?? []), r]);
    const items = [...groups.values()].map((g): AdminArticleRowDto => {
      const d = pageData(g[0]!.data);
      const of = (l: Locale) => g.find((r) => r.locale === l);
      return {
        kind: g[0]!.kind as Kind,
        slug: g[0]!.slug,
        title: of('uz')?.title || of('ru')?.title || g[0]!.slug,
        category: isArticleCategory(d.category) ? d.category : null,
        published: { uz: !!of('uz')?.published, ru: !!of('ru')?.published },
        hasCover: !!g[0]!.coverId,
        publishedAt: d.publishedAt ?? null,
        updatedAt: new Date(Math.max(...g.map((r) => r.updatedAt.getTime()))).toISOString(),
      };
    });
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { items };
  }

  async get(kind: Kind, slug: string): Promise<AdminArticleDto> {
    const rows = await this.prisma.page.findMany({ where: { kind, slug } });
    if (!rows.length) {
      if (kind === CMS_PAGE_KIND && slug === BRAND_PAGE_SLUG) return this.toDto(kind, slug, []);
      throw new DomainError('NOT_FOUND');
    }
    return this.toDto(kind, slug, rows);
  }

  private async toDto(kind: Kind, slug: string, rows: Page[]): Promise<AdminArticleDto> {
    const first = rows[0];
    const d = pageData(first?.data);
    const seo = await this.prisma.seoMeta.findMany({ where: { path: pathOf(kind, slug) } });
    const blocksOf = (r: Page | undefined) => (r ? pageBlocks(r.body) : []);
    const fileIds = [first?.coverId, ...rows.flatMap((r) => blockFileIds(blocksOf(r)))].filter(
      (x): x is string => !!x,
    );
    const files = new Map(
      (await this.prisma.file.findMany({ where: { id: { in: [...new Set(fileIds)] } } })).map(
        (f) => [f.id, f],
      ),
    );
    const cover = first?.coverId ? files.get(first.coverId) : undefined;
    const locale = (l: Locale): AdminPageLocaleDto => {
      const r = rows.find((x) => x.locale === l);
      const m = seo.find((x) => x.locale === l);
      return {
        locale: l,
        exists: !!r,
        published: !!r?.published,
        title: r?.title ?? '',
        excerpt: pageData(r?.data).excerpt ?? '',
        blocks: blocksOf(r),
        seoTitle: m?.title ?? '',
        seoDescription: m?.description ?? '',
        updatedAt: r?.updatedAt.toISOString() ?? null,
      };
    };
    return {
      kind,
      slug,
      category: isArticleCategory(d.category) ? d.category : null,
      cover: cover
        ? {
            fileId: cover.id,
            url: this.files.publicUrl(cover.key),
            width: cover.width,
            height: cover.height,
          }
        : null,
      videoUrl: d.videoUrl ?? null,
      videoMinutes: d.videoMinutes ?? null,
      readingMinutes: d.readingMinutes ?? null,
      sort: d.sort ?? 0,
      relatedProductIds: d.relatedProductIds ?? [],
      publishedAt: d.publishedAt ?? null,
      locales: { uz: locale('uz'), ru: locale('ru') },
      files: Object.fromEntries(
        [...files.values()].map((f) => [f.id, this.files.publicUrl(f.key)]),
      ),
    };
  }

  /** Create (`currentSlug` null) or save an article; the Brend page uses `saveBrand`. */
  async saveArticle(
    actor: AuditActor,
    currentSlug: string | null,
    input: ArticleSaveInput,
  ): Promise<AdminArticleDto> {
    const changed = await this.save(actor, CMS_ARTICLE_KIND, currentSlug, input);
    return this.get(CMS_ARTICLE_KIND, changed);
  }

  async saveBrand(actor: AuditActor, input: ArticleSaveInput): Promise<AdminArticleDto> {
    await this.save(actor, CMS_PAGE_KIND, BRAND_PAGE_SLUG, { ...input, slug: BRAND_PAGE_SLUG });
    return this.get(CMS_PAGE_KIND, BRAND_PAGE_SLUG);
  }

  private async save(
    actor: AuditActor,
    kind: Kind,
    currentSlug: string | null,
    input: ArticleSaveInput,
  ): Promise<string> {
    const slug = input.slug;
    await this.prisma.$transaction(async (tx) => {
      // One writer per document (and per target slug on create/rename).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cms:${kind}`}))`;
      const before = currentSlug
        ? await tx.page.findMany({ where: { kind, slug: currentSlug } })
        : [];
      if (currentSlug && !before.length && kind !== CMS_PAGE_KIND)
        throw new DomainError('NOT_FOUND');
      if (slug !== currentSlug) {
        const taken = await tx.page.count({ where: { kind, slug } });
        if (taken) throw new DomainError('PAGE_SLUG_TAKEN', undefined, 'slug');
      }
      await this.checkRefs(tx, input);

      const prevData = pageData(before[0]?.data);
      const anyPublished = LOCALES.some((l) => input[l].published && input[l].title);
      const publishedAt = prevData.publishedAt ?? (anyPublished ? new Date().toISOString() : null);
      const data = (l: CmsLocaleInput): Prisma.InputJsonValue => ({
        excerpt: l.excerpt,
        category: input.category,
        videoUrl: input.videoUrl,
        videoMinutes: input.videoMinutes,
        readingMinutes: input.readingMinutes,
        sort: input.sort,
        relatedProductIds: input.relatedProductIds,
        publishedAt,
      });

      if (currentSlug && slug !== currentSlug)
        await this.rename(tx, kind, currentSlug, slug, before);

      for (const l of LOCALES) {
        const v = input[l];
        const key = { kind_slug_locale: { kind, slug, locale: l } };
        if (!v.title) {
          // A locale exists only with a title (a blank one removes that language's version).
          await tx.page.deleteMany({ where: { kind, slug, locale: l } });
          continue;
        }
        const row = {
          title: v.title,
          body: v.blocks as Prisma.InputJsonValue,
          published: v.published,
          coverId: input.coverId,
          data: data(v),
        };
        await tx.page.upsert({
          where: key,
          update: row,
          create: { kind, slug, locale: l, ...row },
        });
        await this.saveSeo(tx, pathOf(kind, slug), l, v);
      }

      await this.audit.record(
        actor,
        {
          action: currentSlug ? 'page.update' : 'page.create',
          entity: 'Page',
          entityId: `${kind}/${slug}`,
          before: before.length ? summary(before) : undefined,
          after: {
            slug,
            published: {
              uz: input.uz.published && !!input.uz.title,
              ru: input.ru.published && !!input.ru.title,
            },
            titles: { uz: input.uz.title, ru: input.ru.title },
            blocks: { uz: input.uz.blocks.length, ru: input.ru.blocks.length },
          },
        },
        tx,
      );
    });
    this.afterCommit(kind, [currentSlug, slug]);
    return slug;
  }

  async remove(actor: AuditActor, slug: string, confirm: string): Promise<void> {
    if (confirm !== slug)
      throw new DomainError('ADMIN_CONFIRM_MISMATCH', { expected: slug }, 'confirm');
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.page.findMany({ where: { kind: CMS_ARTICLE_KIND, slug } });
      if (!rows.length) throw new DomainError('NOT_FOUND');
      await tx.page.deleteMany({ where: { kind: CMS_ARTICLE_KIND, slug } });
      await tx.seoMeta.deleteMany({ where: { path: articlePath(slug) } });
      await this.audit.record(
        actor,
        {
          action: 'page.delete',
          entity: 'Page',
          entityId: `${CMS_ARTICLE_KIND}/${slug}`,
          before: summary(rows),
        },
        tx,
      );
    });
    this.afterCommit(CMS_ARTICLE_KIND, [slug]);
  }

  /** Public image for covers and image blocks (`content/<random>.<ext>`). */
  async upload(actor: AuditActor, file: UploadedImage | undefined): Promise<AdminUploadedImageDto> {
    const stored = await this.uploads.storeImage(file, 'content');
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const f = await tx.file.create({ data: stored });
        await this.audit.record(
          actor,
          { action: 'page.image_upload', entity: 'File', entityId: f.id },
          tx,
        );
        return f;
      });
      return {
        fileId: row.id,
        url: this.files.publicUrl(row.key),
        width: row.width,
        height: row.height,
      };
    } catch (e) {
      await this.uploads.discardObject(stored.key);
      throw e;
    }
  }

  private async checkRefs(tx: Tx, input: ArticleSaveInput): Promise<void> {
    const ids = [input.coverId, ...LOCALES.flatMap((l) => blockFileIds(input[l].blocks))].filter(
      (x): x is string => !!x,
    );
    if (ids.length) {
      const unique = [...new Set(ids)];
      const n = await tx.file.count({ where: { id: { in: unique }, isPublic: true } });
      if (n !== unique.length) throw new DomainError('PAGE_FILE_INVALID');
    }
    if (input.relatedProductIds.length) {
      const n = await tx.product.count({ where: { id: { in: input.relatedProductIds } } });
      if (n !== new Set(input.relatedProductIds).size)
        throw new DomainError('VALIDATION_FAILED', undefined, 'relatedProductIds');
    }
  }

  /** SeoMeta is shared with A9 (noindex/canonical/OG stay theirs): only title/description here. */
  private async saveSeo(tx: Tx, path: string, locale: Locale, v: CmsLocaleInput): Promise<void> {
    const existing = await tx.seoMeta.findUnique({ where: { path_locale: { path, locale } } });
    if (existing)
      await tx.seoMeta.update({
        where: { id: existing.id },
        data: { title: v.seoTitle, description: v.seoDescription },
      });
    else if (v.seoTitle || v.seoDescription)
      await tx.seoMeta.create({
        data: { path, locale, title: v.seoTitle, description: v.seoDescription },
      });
  }

  /** Slug change: rows and SEO move, published locales get 301s from the old URL. */
  private async rename(tx: Tx, kind: Kind, from: string, to: string, rows: Page[]): Promise<void> {
    await tx.page.updateMany({ where: { kind, slug: from }, data: { slug: to } });
    await tx.seoMeta.deleteMany({ where: { path: pathOf(kind, to) } });
    await tx.seoMeta.updateMany({
      where: { path: pathOf(kind, from) },
      data: { path: pathOf(kind, to) },
    });
    await tx.redirect.deleteMany({
      where: { from: { in: LOCALES.map((l) => `/${l}${pathOf(kind, to)}`) } },
    });
    for (const r of rows.filter((x) => x.published))
      await saveRedirect(
        tx,
        {
          from: `/${r.locale}${pathOf(kind, from)}`,
          to: `/${r.locale}${pathOf(kind, to)}`,
          code: 301,
        },
        { siteHost: null },
      );
  }

  private afterCommit(kind: Kind, slugs: (string | null)[]): void {
    const unique = [...new Set(slugs.filter((s): s is string => !!s))];
    const paths = unique.map((s) => pathOf(kind, s));
    this.web.revalidate(
      ['content', 'articles', ...unique.map((s) => `page:${s}`), ...paths.map((p) => `seo:${p}`)],
      'cms',
    );
    void Promise.all([this.sitemap.schedule(), this.indexNow.enqueue(paths)]).catch((e: unknown) =>
      this.logger.warn(`after save: ${String(e)}`),
    );
  }
}

function summary(rows: Page[]) {
  return {
    slug: rows[0]?.slug,
    published: Object.fromEntries(rows.map((r) => [r.locale, r.published])),
    titles: Object.fromEntries(rows.map((r) => [r.locale, r.title])),
  };
}
