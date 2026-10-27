import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  type PartnerListQuery,
  type PartnerProductDto,
  type PartnerProductPageDto,
  type PartnerStockDto,
  type PartnerStockQuery,
  tiyinToSoumInt,
} from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { availableQty } from '../catalog/catalog.mapper';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';

const include = {
  variants: { orderBy: [{ sort: 'asc' }, { id: 'asc' }] },
  categories: { include: { category: { select: { slug: true } } } },
  images: {
    where: { isVideo: false, file: { isPublic: true } },
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    include: { file: { select: { key: true } } },
  },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof include }>;

const loc = (v: unknown) => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === 'string' ? x : '');
  return { uz: s(o.uz), ru: s(o.ru) };
};

const decodeCursor = (c: string | undefined) => {
  if (!c) return undefined;
  const id = Buffer.from(c, 'base64url').toString('utf8');
  if (!/^[a-z0-9]{8,64}$/i.test(id))
    throw new DomainError('VALIDATION_FAILED', undefined, 'cursor');
  return id;
};
const encodeCursor = (id: string) => Buffer.from(id).toString('base64url');

/**
 * Read-only partner API (CLAUDE.md §6): public catalog data only — ACTIVE products, so'm
 * prices, sellable stock. Keyset pagination over ids.
 */
@Injectable()
export class PartnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private map(p: ProductRow): PartnerProductDto {
    const site = this.env.APP_URL.replace(/\/$/, '');
    return {
      id: p.id,
      slug: p.slug,
      type: p.type,
      name: loc(p.name),
      shortDescription: loc(p.shortDesc),
      categories: p.categories.map((c) => c.category.slug),
      url: { uz: `${site}/uz/p/${p.slug}`, ru: `${site}/ru/p/${p.slug}` },
      images: p.images.map((i) => this.files.publicUrl(i.file.key)),
      variants: p.variants.map((v) => ({
        sku: v.sku,
        label: loc(v.label),
        priceUzs: tiyinToSoumInt(v.priceTiyin),
        compareAtUzs: v.compareAtTiyin === null ? null : tiyinToSoumInt(v.compareAtTiyin),
        available: v.active ? availableQty(v) : 0,
        active: v.active,
      })),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async products(q: PartnerListQuery): Promise<PartnerProductPageDto> {
    const after = decodeCursor(q.cursor);
    const rows = await this.prisma.product.findMany({
      where: { status: 'ACTIVE', ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
      include,
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((p) => this.map(p)),
      nextCursor: rows.length > q.limit ? encodeCursor(page.at(-1)!.id) : null,
    };
  }

  async product(slug: string): Promise<PartnerProductDto> {
    const p = await this.prisma.product.findFirst({ where: { slug, status: 'ACTIVE' }, include });
    if (!p) throw new DomainError('PRODUCT_NOT_FOUND');
    return this.map(p);
  }

  async stock(q: PartnerStockQuery): Promise<PartnerStockDto> {
    const after = q.sku ? undefined : decodeCursor(q.cursor);
    const rows = await this.prisma.variant.findMany({
      where: {
        product: { status: 'ACTIVE' },
        ...(q.sku ? { sku: { in: q.sku } } : {}),
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: 'asc' },
      take: q.sku ? q.sku.length : q.limit + 1,
      select: { id: true, sku: true, stock: true, reserved: true, active: true, updatedAt: true },
    });
    const page = q.sku ? rows : rows.slice(0, q.limit);
    return {
      items: page.map((v) => ({
        sku: v.sku,
        available: v.active ? availableQty(v) : 0,
        active: v.active,
        updatedAt: v.updatedAt.toISOString(),
      })),
      nextCursor: !q.sku && rows.length > q.limit ? encodeCursor(page.at(-1)!.id) : null,
    };
  }
}
