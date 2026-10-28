import { Injectable } from '@nestjs/common';
import {
  type ArticleBlockDto,
  type ArticleCardDto,
  type ArticleCategory,
  type ArticleDto,
  type ArticleListDto,
  type ArticleListQuery,
  type ArticleRelatedProductDto,
  BRAND_PAGE_SLUG,
  type BrandStoryDto,
  CMS_ARTICLE_KIND,
  CMS_LIMITS,
  CMS_PAGE_KIND,
  type CmsImageDto,
  type ContentBlock,
  DomainError,
  isArticleCategory,
  type Locale,
  t,
  tiyinToSoumInt,
} from '@forest/contracts';
import type { Page } from '@forest/db';
import { availableQty } from '../catalog/catalog.mapper';
import { ContentService } from '../customer/content/content.service';
import { fillBlocks } from '../customer/content/blocks';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { blockFileIds, pageBlocks, pageData } from './page-data';

type FileRow = {
  id: string;
  key: string;
  isPublic: boolean;
  width: number | null;
  height: number | null;
};

/**
 * Storefront reads of the Ilhom/Brend CMS (CLAUDE.md §6). An article exists in a locale only when
 * that locale's row is published — no fallback to another language inside one URL.
 */
@Injectable()
export class CmsPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly content: ContentService,
  ) {}

  private image(f: FileRow | undefined, alt: string): CmsImageDto | null {
    if (!f?.isPublic) return null;
    return { url: this.files.publicUrl(f.key), alt, width: f.width, height: f.height };
  }

  private async fileMap(ids: (string | null | undefined)[]): Promise<Map<string, FileRow>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.file.findMany({
      where: { id: { in: unique } },
      select: { id: true, key: true, isPublic: true, width: true, height: true },
    });
    return new Map(rows.map((f) => [f.id, f]));
  }

  private card(p: Page, files: Map<string, FileRow>): ArticleCardDto {
    const d = pageData(p.data);
    return {
      slug: p.slug,
      title: p.title,
      excerpt: d.excerpt || null,
      category: isArticleCategory(d.category) ? d.category : null,
      cover: this.image(files.get(p.coverId ?? ''), p.title),
      readingMinutes: d.readingMinutes ?? null,
      videoMinutes: d.videoMinutes ?? null,
      hasVideo: !!d.videoUrl,
      publishedAt: d.publishedAt ?? null,
    };
  }

  async list(locale: Locale, q: ArticleListQuery): Promise<ArticleListDto> {
    const rows = await this.prisma.page.findMany({
      where: { kind: CMS_ARTICLE_KIND, locale, published: true },
    });
    // Few hundred articles at most: sort/filter in memory (like the catalog listing).
    const sorted = rows
      .map((p) => ({ p, d: pageData(p.data) }))
      .sort(
        (a, b) =>
          (a.d.sort ?? 0) - (b.d.sort ?? 0) ||
          (b.d.publishedAt ?? '').localeCompare(a.d.publishedAt ?? '') ||
          a.p.slug.localeCompare(b.p.slug),
      );
    const categories = [
      ...new Set(sorted.map((x) => x.d.category).filter(isArticleCategory)),
    ] as ArticleCategory[];
    const filtered = q.category ? sorted.filter((x) => x.d.category === q.category) : sorted;
    const size = CMS_LIMITS.listPageSize;
    const pages = Math.max(1, Math.ceil(filtered.length / size));
    const slice = filtered.slice((q.page - 1) * size, q.page * size);
    const files = await this.fileMap(slice.map((x) => x.p.coverId));
    return {
      items: slice.map((x) => this.card(x.p, files)),
      categories,
      page: q.page,
      pages,
      total: filtered.length,
    };
  }

  async article(locale: Locale, slug: string): Promise<ArticleDto> {
    const rows = await this.prisma.page.findMany({
      where: { kind: CMS_ARTICLE_KIND, slug, published: true },
    });
    const page = rows.find((r) => r.locale === locale);
    if (!page) throw new DomainError('NOT_FOUND');
    const d = pageData(page.data);
    const blocks = fillBlocks(pageBlocks(page.body), await this.content.vars());
    const files = await this.fileMap([page.coverId, ...blockFileIds(blocks)]);
    return {
      ...this.card(page, files),
      locale,
      locales: rows.map((r) => r.locale).sort(),
      videoUrl: d.videoUrl ?? null,
      blocks: this.blocks(blocks, files),
      related: await this.related(d.relatedProductIds ?? [], locale),
      updatedAt: page.updatedAt.toISOString(),
    };
  }

  async brand(locale: Locale): Promise<BrandStoryDto> {
    const page = await this.prisma.page.findUnique({
      where: { kind_slug_locale: { kind: CMS_PAGE_KIND, slug: BRAND_PAGE_SLUG, locale } },
    });
    if (!page?.published) throw new DomainError('NOT_FOUND');
    const blocks = fillBlocks(pageBlocks(page.body), await this.content.vars());
    const files = await this.fileMap([page.coverId, ...blockFileIds(blocks)]);
    return {
      title: page.title,
      excerpt: pageData(page.data).excerpt || null,
      cover: this.image(files.get(page.coverId ?? ''), page.title),
      blocks: this.blocks(blocks, files),
      updatedAt: page.updatedAt.toISOString(),
    };
  }

  /** Stored blocks → rendered DTOs; an image whose file is gone or private is dropped. */
  private blocks(blocks: ContentBlock[], files: Map<string, FileRow>): ArticleBlockDto[] {
    return blocks.flatMap((b): ArticleBlockDto[] => {
      switch (b.type) {
        case 'image': {
          const image = this.image(files.get(b.fileId), b.alt);
          return image ? [{ type: 'image', image, caption: b.caption || null }] : [];
        }
        case 'quote':
          return [{ type: 'quote', text: b.text, cite: b.cite || null }];
        default:
          return [b];
      }
    });
  }

  private async related(ids: string[], locale: Locale): Promise<ArticleRelatedProductDto[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      include: {
        variants: { where: { active: true } },
        images: {
          where: { isVideo: false },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
          take: 1,
          include: { file: true },
        },
      },
    });
    const byId = new Map(rows.map((p) => [p.id, p]));
    return ids.flatMap((id) => {
      const p = byId.get(id);
      if (!p || p.variants.length === 0) return [];
      const name = t(p.name, locale);
      const img = p.images[0];
      return [
        {
          slug: p.slug,
          name,
          image: img ? this.image(img.file, t(img.alt, locale) || name) : null,
          priceFromUzs: Math.min(...p.variants.map((v) => tiyinToSoumInt(v.priceTiyin))),
          inStock: p.variants.some((v) => availableQty(v) > 0),
        },
      ];
    });
  }
}
