import { Injectable } from '@nestjs/common';
import type { Locale, ProductCardDto } from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { mapProductCard } from '../../catalog/catalog.mapper';
import { FilesService } from '../../files/files.service';
import { PrismaService } from '../../prisma/prisma.service';

const cardInclude = {
  variants: true,
  categories: { include: { category: true } },
  seller: { select: { slug: true, name: true, isOfficial: true } },
  images: { include: { file: true }, orderBy: { sort: 'asc' }, take: 1 },
} satisfies Prisma.ProductInclude;

/**
 * Product cards for an explicit id list (favorites, search hits), in the given order.
 * Same mapping as CatalogService; CatalogService has no by-ids lookup yet.
 */
@Injectable()
export class ProductCards {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  async byIds(ids: readonly string[], locale: Locale): Promise<ProductCardDto[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.product.findMany({
      where: { id: { in: [...ids] }, status: 'ACTIVE' },
      include: cardInclude,
    });
    const byId = new Map(rows.map((p) => [p.id, p]));
    return ids.flatMap((id) => {
      const p = byId.get(id);
      if (!p) return [];
      const card = mapProductCard(p, locale);
      const img = p.images[0];
      card.image = img ? this.files.image(img.file, img.alt ?? p.name, locale) : null;
      return [card];
    });
  }
}
