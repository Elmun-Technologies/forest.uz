import { Injectable, Logger } from '@nestjs/common';
import {
  type AdminGalleryItemDto,
  type AdminReviewDto,
  type AdminReviewListQuery,
  type AdminReviewPageDto,
  type AdminReviewPhotoDto,
  type AdminReviewsSummaryDto,
  DomainError,
  type IdOrderInput,
  type ReviewGalleryInput,
  type ReviewModerateInput,
  type ReviewReplyInput,
} from '@forest/contracts';
import type { Prisma, Review } from '@forest/db';
import { reviewAuthor } from '../../catalog/catalog.mapper';
import { publishReviewPhotos, unpublishReviewPhotos } from '../../bot/review-photos';
import { FilesService } from '../../files/files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SeoEventsService } from '../../seo/seo-events.service';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AdminUploadService, type UploadedImage } from '../files/upload.service';
import { afterCursor, encodeCursor } from '../products/cursor';
import { localized } from '../products/product-text';
import { assertPermutation } from '../products/variants.service';

type Tx = Prisma.TransactionClient;

const reviewInclude = {
  customer: { select: { name: true } },
  product: { select: { id: true, slug: true, name: true } },
} satisfies Prisma.ReviewInclude;

type ReviewRow = Prisma.ReviewGetPayload<{ include: typeof reviewInclude }>;

/** Gallery-eligible: public, consented, with a photo (docs/02 "photos only with consent"). */
const canBeInGallery = (r: Pick<Review, 'status' | 'photoConsent' | 'photoFileIds'>) =>
  r.status === 'APPROVED' && r.photoConsent && r.photoFileIds.length > 0;

/**
 * A15 "Sharhlar va fotolar": moderation (approve/reject/public reply) and the "Natijalar" gallery
 * (membership, order, before/after pairs) that the home page reads (`ContentService.gallery`).
 */
@Injectable()
export class AdminReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly uploads: AdminUploadService,
    private readonly seoEvents: SeoEventsService,
    private readonly files: FilesService,
  ) {}

  private readonly logger = new Logger('AdminReviews');

  async summary(): Promise<AdminReviewsSummaryDto> {
    const [byStatus, approvedAgg, withPhoto, openLowRated] = await Promise.all([
      this.prisma.review.groupBy({ by: ['status'], _count: true }),
      this.prisma.review.aggregate({ where: { status: 'APPROVED' }, _avg: { rating: true } }),
      this.prisma.review.count({
        where: { status: 'APPROVED', photoConsent: true, NOT: { photoFileIds: { isEmpty: true } } },
      }),
      this.prisma.review.count({
        where: { rating: { lte: 3 }, status: { not: 'REJECTED' }, reply: null },
      }),
    ]);
    const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
    for (const r of byStatus) counts[r.status] = r._count;
    const avg = approvedAgg._avg.rating;
    return {
      avgRating: counts.APPROVED > 0 && avg !== null ? Math.round(avg * 10) / 10 : null,
      approved: counts.APPROVED,
      withPhotoPct: counts.APPROVED > 0 ? Math.round((withPhoto / counts.APPROVED) * 100) : null,
      openLowRated,
      counts,
    };
  }

  async pendingCount(): Promise<number> {
    return this.prisma.review.count({ where: { status: 'PENDING' } });
  }

  async list(q: AdminReviewListQuery): Promise<AdminReviewPageDto> {
    const where: Prisma.ReviewWhereInput = {
      AND: [
        { status: q.status },
        q.low ? { rating: { lte: 3 } } : {},
        q.photos ? { NOT: { photoFileIds: { isEmpty: true } } } : {},
        q.source ? { source: q.source } : {},
        q.productId ? { productId: q.productId } : {},
        afterCursor(q.cursor, 'desc'),
      ],
    };
    const rows = await this.prisma.review.findMany({
      where,
      include: reviewInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: await this.toDtos(page),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async moderate(
    actor: AuditActor,
    id: string,
    input: ReviewModerateInput,
  ): Promise<AdminReviewDto> {
    const dto = await this.moderateRow(actor, id, input);
    // Bot photos are public only while the review is approved with consent (5A); after commit.
    const changed =
      input.status === 'APPROVED'
        ? await publishReviewPhotos(this.prisma, this.files, id, this.logger)
        : await unpublishReviewPhotos(this.prisma, this.files, id, this.logger);
    if (!changed) return dto;
    const row = await this.prisma.review.findUniqueOrThrow({
      where: { id },
      include: reviewInclude,
    });
    return (await this.toDtos([row]))[0]!;
  }

  private moderateRow(
    actor: AuditActor,
    id: string,
    input: ReviewModerateInput,
  ): Promise<AdminReviewDto> {
    return this.change(actor, id, 'review.moderate', (r) => ({
      status: input.status,
      moderatedBy: actor.staffId,
      // A rejected review leaves the public gallery at once.
      ...(input.status === 'REJECTED' && r.inGallery
        ? { inGallery: false, gallerySort: null }
        : {}),
    }));
  }

  async reply(actor: AuditActor, id: string, input: ReviewReplyInput): Promise<AdminReviewDto> {
    return this.change(actor, id, 'review.reply', () => ({ reply: input.reply }));
  }

  async gallery(actor: AuditActor, id: string, input: ReviewGalleryInput): Promise<AdminReviewDto> {
    let replaced: string | null = null;
    const dto = await this.change(actor, id, 'review.gallery', async (r, tx) => {
      const data: Prisma.ReviewUpdateInput = {};
      if (input.afterFileId !== undefined) {
        if (!r.photoFileIds.includes(input.afterFileId))
          throw new DomainError('REVIEW_PHOTO_NOT_FOUND', undefined, 'afterFileId');
        data.photoFileIds = [
          input.afterFileId,
          ...r.photoFileIds.filter((f) => f !== input.afterFileId),
        ];
      }
      if (input.beforeFileId !== undefined) {
        if (
          input.beforeFileId !== null &&
          !(await this.isBeforeCandidate(tx, r, input.beforeFileId))
        )
          throw new DomainError('REVIEW_PHOTO_NOT_FOUND', undefined, 'beforeFileId');
        data.beforeFileId = input.beforeFileId;
        if (r.beforeFileId && r.beforeFileId !== input.beforeFileId) replaced = r.beforeFileId;
      }
      if (input.inGallery !== undefined && input.inGallery !== r.inGallery) {
        if (input.inGallery) {
          if (!canBeInGallery(r)) throw new DomainError('REVIEW_GALLERY_NOT_ALLOWED');
          const last = await tx.review.aggregate({
            where: { inGallery: true },
            _max: { gallerySort: true },
          });
          data.inGallery = true;
          data.gallerySort = (last._max.gallerySort ?? -1) + 1;
        } else {
          data.inGallery = false;
          data.gallerySort = null;
        }
      }
      return data;
    });
    // A replaced staff upload is no longer referenced: drop its row and object. Customer photos
    // stay (they are still in `photoFileIds`, which `discardUnreferenced` checks).
    if (replaced) await this.uploads.discardUnreferenced([replaced]);
    return dto;
  }

  /** Staff "before" photo for a pair (public bucket), then linked like `gallery({beforeFileId})`. */
  async uploadBefore(
    actor: AuditActor,
    id: string,
    file: UploadedImage | undefined,
  ): Promise<AdminReviewDto> {
    const exists = await this.prisma.review.count({ where: { id } });
    if (!exists) throw new DomainError('NOT_FOUND');
    const stored = await this.uploads.storeImage(file, `reviews/${id}`);
    let previous: string | null = null;
    let dto: AdminReviewDto;
    try {
      dto = await this.change(actor, id, 'review.before_upload', async (r, tx) => {
        const row = await tx.file.create({ data: stored });
        previous = r.beforeFileId;
        return { beforeFileId: row.id };
      });
    } catch (e) {
      await this.uploads.discardObject(stored.key);
      throw e;
    }
    if (previous) await this.uploads.discardUnreferenced([previous]);
    return dto;
  }

  async galleryItems(): Promise<AdminGalleryItemDto[]> {
    const rows = await this.prisma.review.findMany({
      where: { inGallery: true },
      orderBy: [{ gallerySort: 'asc' }, { createdAt: 'desc' }],
      include: reviewInclude,
    });
    const photos = await this.photoMap(rows);
    return rows.flatMap((r, i) => {
      const after = photos.get(r.photoFileIds[0] ?? '');
      if (!after) return [];
      return [
        {
          reviewId: r.id,
          sort: r.gallerySort ?? i,
          after,
          before: r.beforeFileId ? (photos.get(r.beforeFileId) ?? null) : null,
          photos: r.photoFileIds.flatMap((f) => {
            const p = photos.get(f);
            return p ? [p] : [];
          }),
          productName: localized(r.product.name),
          author: reviewAuthor(r.customer.name, 'uz'),
        },
      ];
    });
  }

  async reorderGallery(actor: AuditActor, input: IdOrderInput): Promise<AdminGalleryItemDto[]> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.review.findMany({
        where: { inGallery: true },
        orderBy: [{ gallerySort: 'asc' }, { createdAt: 'desc' }],
        select: { id: true },
      });
      assertPermutation(
        rows.map((r) => r.id),
        input.ids,
      );
      for (const [gallerySort, id] of input.ids.entries())
        await tx.review.update({ where: { id }, data: { gallerySort } });
      await this.audit.record(
        actor,
        {
          action: 'review.gallery_reorder',
          entity: 'Review',
          before: { ids: rows.map((r) => r.id) },
          after: { ids: input.ids },
        },
        tx,
      );
    });
    this.seoEvents.reviewsChanged(null);
    return this.galleryItems();
  }

  // ───────── helpers ─────────

  /** Locked read-modify-write with an audit row of the changed fields. */
  private async change(
    actor: AuditActor,
    id: string,
    action: string,
    build: (r: Review, tx: Tx) => Prisma.ReviewUpdateInput | Promise<Prisma.ReviewUpdateInput>,
  ): Promise<AdminReviewDto> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Review" WHERE "id" = ${id} FOR UPDATE`;
      const before = await tx.review.findUnique({ where: { id } });
      if (!before) throw new DomainError('NOT_FOUND');
      const data = await build(before, tx);
      const after = Object.keys(data).length
        ? await tx.review.update({ where: { id }, data })
        : before;
      const keys = (Object.keys(data) as (keyof Review)[]).filter(
        (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
      );
      await this.audit.record(
        actor,
        {
          action,
          entity: 'Review',
          entityId: id,
          before: Object.fromEntries(keys.map((k) => [k, before[k]])),
          after: Object.fromEntries(keys.map((k) => [k, after[k]])),
        },
        tx,
      );
    });
    const row = await this.prisma.review.findUniqueOrThrow({
      where: { id },
      include: reviewInclude,
    });
    // Rating, review list and the home gallery are cached on the storefront.
    this.seoEvents.reviewsChanged(row.product.slug);
    const [dto] = await this.toDtos([row]);
    return dto!;
  }

  /** A "before" photo is one of the customer's own photos or a staff upload for this review. */
  private async isBeforeCandidate(tx: Tx, r: Review, fileId: string): Promise<boolean> {
    if (r.photoFileIds.includes(fileId)) return true;
    const f = await tx.file.findUnique({ where: { id: fileId }, select: { key: true } });
    return !!f && f.key.startsWith(`reviews/${r.id}/`);
  }

  private async photoMap(rows: Review[]): Promise<Map<string, AdminReviewPhotoDto>> {
    const ids = [
      ...new Set(
        rows.flatMap((r) => [...r.photoFileIds, ...(r.beforeFileId ? [r.beforeFileId] : [])]),
      ),
    ];
    if (ids.length === 0) return new Map();
    const files = await this.prisma.file.findMany({ where: { id: { in: ids } } });
    const entries = await Promise.all(
      files.map(async (f) => [f.id, { fileId: f.id, url: await this.uploads.viewUrl(f) }] as const),
    );
    return new Map(entries);
  }

  private async toDtos(rows: ReviewRow[]): Promise<AdminReviewDto[]> {
    const orderIds = [...new Set(rows.map((r) => r.orderId))];
    const staffIds = [...new Set(rows.map((r) => r.moderatedBy).filter((x): x is string => !!x))];
    const [orders, staff, photos] = await Promise.all([
      this.prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          number: true,
          items: { select: { variant: { select: { productId: true, label: true } } } },
        },
      }),
      this.prisma.staff.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, name: true },
      }),
      this.photoMap(rows),
    ]);
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const staffName = new Map(staff.map((s) => [s.id, s.name]));
    return rows.map((r) => {
      const order = orderById.get(r.orderId);
      const variant = order?.items.find((i) => i.variant.productId === r.productId)?.variant;
      return {
        id: r.id,
        status: r.status,
        rating: r.rating,
        text: r.text,
        locale: r.locale,
        source: r.source,
        createdAt: r.createdAt.toISOString(),
        author: reviewAuthor(r.customer.name, r.locale),
        product: { id: r.product.id, slug: r.product.slug, name: localized(r.product.name) },
        variantLabel: variant ? localized(variant.label) : null,
        order: { id: r.orderId, number: order?.number ?? '—' },
        photos: r.photoFileIds.flatMap((f) => {
          const p = photos.get(f);
          return p ? [p] : [];
        }),
        photoConsent: r.photoConsent,
        inGallery: r.inGallery,
        gallerySort: r.gallerySort,
        before: r.beforeFileId ? (photos.get(r.beforeFileId) ?? null) : null,
        reply: r.reply,
        moderatedBy: r.moderatedBy ? (staffName.get(r.moderatedBy) ?? null) : null,
      };
    });
  }
}
