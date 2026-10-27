import { STAFF_ROLES, type StaffRole } from '@forest/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env';
import { FilesService } from '../src/files/files.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { type AdminClient, createAdminTestApp, signedIn } from './admin-helpers';

class MemoryFiles extends FilesService {
  override async put(): Promise<void> {}
  override async remove(): Promise<void> {}
}

function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
}

const run = Date.now().toString(36);

/**
 * The seed has no reviews (docs/02: never fake them), so this suite creates verified purchases:
 * a customer, a DELIVERED order with the product, and the review rows.
 */
describe('admin reviews & gallery A15 (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const clients = new Map<StaffRole, AdminClient>();
  let owner: AdminClient;
  const customerIds: string[] = [];
  const fileIds: string[] = [];

  async function photo(tag: string, isPublic = true) {
    const f = await prisma.file.create({
      data: { key: `reviews-test/${run}/${tag}.jpg`, mime: 'image/jpeg', size: 1, isPublic },
    });
    fileIds.push(f.id);
    return f.id;
  }

  async function review(opts: {
    rating: number;
    photos?: string[];
    consent?: boolean;
    text?: string;
    source?: string;
  }) {
    const variant = await prisma.variant.findUniqueOrThrow({
      where: { sku: 'FR-CW-1000' },
      include: { product: true },
    });
    const customer = await prisma.customer.create({
      data: {
        phone: `+99890${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
        name: 'Dilnoza Yusupova',
      },
    });
    customerIds.push(customer.id);
    const order = await prisma.order.create({
      data: {
        publicId: `rv-${run}-${customer.id}`,
        trackingToken: `rv-${customer.id}`,
        customerId: customer.id,
        status: 'DELIVERED',
        contactName: 'Dilnoza',
        contactPhone: customer.phone!,
        address: { region: 'tashkent', line: '—' },
        subtotalTiyin: variant.priceTiyin,
        totalTiyin: variant.priceTiyin,
        paymentMethod: 'COD',
        deliveryZone: 'tashkent',
        carrier: 'YANDEX',
        offerVersion: '1',
        items: {
          create: {
            variantId: variant.id,
            sellerId: variant.product.sellerId,
            nameSnapshot: variant.product.name ?? {},
            sku: variant.sku,
            ikpu: '03209001001000000',
            vatPercent: 12,
            qty: 1,
            priceTiyin: variant.priceTiyin,
          },
        },
      },
    });
    return prisma.review.create({
      data: {
        productId: variant.productId,
        customerId: customer.id,
        orderId: order.id,
        rating: opts.rating,
        text: opts.text ?? 'Juda yaxshi natija.',
        locale: 'uz',
        source: opts.source ?? 'web',
        photoFileIds: opts.photos ?? [],
        photoConsent: opts.consent ?? false,
      },
    });
  }

  beforeAll(async () => {
    app = await createAdminTestApp([], {}, (b) =>
      b
        .overrideProvider(FilesService)
        .useFactory({ factory: (env: Env) => new MemoryFiles(env), inject: [ENV] }),
    );
    prisma = app.get(PrismaService);
    for (const role of STAFF_ROLES) clients.set(role, (await signedIn(app, role)).client);
    owner = clients.get('OWNER')!;
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.order.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.file.deleteMany({
      where: { OR: [{ id: { in: fileIds } }, { key: { startsWith: 'reviews/' } }] },
    });
    await app.close();
  });

  describe('RBAC per role', () => {
    const table: [StaffRole, number, number][] = [
      // role, GET /admin/reviews, PATCH status of an unknown review (404 = allowed through)
      ['OWNER', 200, 404],
      ['MANAGER', 200, 404],
      ['MARKETER', 200, 404],
      ['OPERATOR', 200, 403],
      ['WAREHOUSE', 403, 403],
    ];
    for (const [role, view, moderate] of table) {
      it(`${role}: view ${view}, moderate ${moderate}`, async () => {
        const c = clients.get(role)!;
        expect((await c.get('/v1/admin/reviews')).status).toBe(view);
        expect((await c.get('/v1/admin/reviews/pending-count')).status).toBe(view);
        const res = await c.send('patch', '/v1/admin/reviews/nope/status', { status: 'APPROVED' });
        expect(res.status).toBe(moderate);
      });
    }
  });

  it('moderates: KPIs, list by state, approve/reject, public reply, audit', async () => {
    const good = await review({ rating: 5, photos: [await photo('g1')], consent: true });
    const low = await review({ rating: 2, text: 'Rang mos kelmadi', source: 'bot' });
    const before = await owner.get('/v1/admin/reviews/summary');
    expect(before.body.counts.PENDING).toBeGreaterThanOrEqual(2);
    expect(before.body.openLowRated).toBeGreaterThanOrEqual(1);
    expect((await owner.get('/v1/admin/reviews/pending-count')).body.count).toBe(
      before.body.counts.PENDING,
    );

    const pending = await owner.get('/v1/admin/reviews?status=PENDING');
    const item = pending.body.items.find((r: { id: string }) => r.id === good.id);
    expect(item.author).toBe('Dilnoza');
    expect(item.order.number).toMatch(/^F-\d+$/);
    expect(item.variantLabel).toEqual({ uz: '1 L', ru: '1 л' });
    expect(item.photos[0].url).toContain(`reviews-test/${run}/g1.jpg`);
    const lowOnly = await owner.get('/v1/admin/reviews?status=PENDING&low=1&source=bot');
    expect(lowOnly.body.items.map((r: { id: string }) => r.id)).toEqual([low.id]);

    let res = await owner.send('patch', `/v1/admin/reviews/${good.id}/status`, {
      status: 'APPROVED',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.moderatedBy).toBe('OWNER tester');
    res = await owner.send('patch', `/v1/admin/reviews/${low.id}/reply`, {
      reply: 'Uzr! Operator siz bilan bog‘lanadi.',
    });
    expect(res.body.reply).toContain('Operator');
    res = await owner.send('patch', `/v1/admin/reviews/${low.id}/status`, { status: 'REJECTED' });
    expect(res.body.status).toBe('REJECTED');

    const after = await owner.get('/v1/admin/reviews/summary');
    expect(after.body.approved).toBe(before.body.approved + 1);
    expect(after.body.avgRating).not.toBeNull();
    expect(after.body.openLowRated).toBe(before.body.openLowRated - 1);

    // Storefront shows the approved review with its consented photo.
    const product = await prisma.product.findUniqueOrThrow({ where: { id: good.productId } });
    const shop = await request(app.getHttpServer())
      .get(`/v1/catalog/products/${product.slug}/reviews`)
      .expect(200);
    expect(shop.body.items.map((r: { id: string }) => r.id)).toContain(good.id);

    const audit = await prisma.auditLog.findMany({
      where: { entity: 'Review', entityId: { in: [good.id, low.id] } },
    });
    expect(audit.map((a) => a.action).sort()).toEqual([
      'review.moderate',
      'review.moderate',
      'review.reply',
    ]);
    const moderation = audit.find((a) => a.entityId === good.id);
    expect(moderation?.before).toMatchObject({ status: 'PENDING' });
    expect(moderation?.after).toMatchObject({ status: 'APPROVED' });
  });

  it('gallery: consent rule, before/after pairs, ordering, home page, reject removes it', async () => {
    const noConsent = await review({ rating: 5, photos: [await photo('nc')], consent: false });
    await owner.send('patch', `/v1/admin/reviews/${noConsent.id}/status`, { status: 'APPROVED' });
    let res = await owner.send('patch', `/v1/admin/reviews/${noConsent.id}/gallery`, {
      inGallery: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REVIEW_GALLERY_NOT_ALLOWED');

    const pendingOne = await review({ rating: 5, photos: [await photo('p1')], consent: true });
    res = await owner.send('patch', `/v1/admin/reviews/${pendingOne.id}/gallery`, {
      inGallery: true,
    });
    expect(res.body.error.code).toBe('REVIEW_GALLERY_NOT_ALLOWED');

    const [a1, a2] = [await photo('a1'), await photo('a2')];
    const first = await review({ rating: 5, photos: [a1, a2], consent: true });
    const second = await review({ rating: 4, photos: [await photo('b1')], consent: true });
    for (const r of [first, second])
      await owner.send('patch', `/v1/admin/reviews/${r.id}/status`, { status: 'APPROVED' });

    res = await owner.send('patch', `/v1/admin/reviews/${first.id}/gallery`, {
      inGallery: true,
      afterFileId: a2,
      beforeFileId: a1,
    });
    expect(res.status).toBe(200);
    expect(res.body.photos.map((p: { fileId: string }) => p.fileId)).toEqual([a2, a1]);
    expect(res.body.before.fileId).toBe(a1);
    res = await owner.send('patch', `/v1/admin/reviews/${second.id}/gallery`, { inGallery: true });
    expect(res.body.inGallery).toBe(true);

    // A foreign file can't be a "before" photo; a staff upload for this review can.
    const foreign = await photo('foreign');
    res = await owner.send('patch', `/v1/admin/reviews/${second.id}/gallery`, {
      beforeFileId: foreign,
    });
    expect(res.body.error.code).toBe('REVIEW_PHOTO_NOT_FOUND');
    const up = await owner.agent
      .post(`/v1/admin/reviews/${second.id}/before-photo`)
      .set('X-Forwarded-For', owner.ip)
      .set('X-CSRF-Token', owner.csrf ?? '')
      .attach('file', png(800, 600), 'before.png');
    expect(up.status).toBe(201);
    expect(up.body.before.url).toMatch(new RegExp(`/reviews/${second.id}/`));
    // Replacing the staff "before" photo drops the old upload (row + object); a customer photo
    // used as "before" is never deleted.
    const staffBefore = up.body.before.fileId as string;
    const own = await photo('b2');
    await prisma.review.update({
      where: { id: second.id },
      data: { photoFileIds: { push: own } },
    });
    res = await owner.send('patch', `/v1/admin/reviews/${second.id}/gallery`, {
      beforeFileId: own,
    });
    expect(res.body.before.fileId).toBe(own);
    expect(await prisma.file.findUnique({ where: { id: staffBefore } })).toBeNull();
    res = await owner.send('patch', `/v1/admin/reviews/${second.id}/gallery`, {
      beforeFileId: null,
    });
    expect(res.body.before).toBeNull();
    expect(await prisma.file.findUnique({ where: { id: own } })).not.toBeNull();

    let gallery = await owner.get('/v1/admin/reviews/gallery');
    expect(gallery.body.map((g: { reviewId: string }) => g.reviewId)).toEqual([
      first.id,
      second.id,
    ]);
    res = await owner.send('put', '/v1/admin/reviews/gallery/order', {
      ids: [second.id, first.id],
    });
    expect(res.body.map((g: { reviewId: string }) => g.reviewId)).toEqual([second.id, first.id]);
    res = await owner.send('put', '/v1/admin/reviews/gallery/order', { ids: [second.id] });
    expect(res.status).toBe(400);

    const home = await request(app.getHttpServer()).get('/v1/content/home').expect(200);
    expect(home.body.gallery).toHaveLength(2);
    // `second` (first now) lost its pair above; `first` keeps a1 as "before".
    expect(home.body.gallery[0].before).toBeNull();
    expect(home.body.gallery[1].before).not.toBeNull();

    // Rejecting takes it out of the public gallery at once.
    await owner.send('patch', `/v1/admin/reviews/${second.id}/status`, { status: 'REJECTED' });
    gallery = await owner.get('/v1/admin/reviews/gallery');
    expect(gallery.body.map((g: { reviewId: string }) => g.reviewId)).toEqual([first.id]);

    // Marketer moderates, operator only reads.
    const op = clients.get('OPERATOR')!;
    expect(
      (await op.send('patch', `/v1/admin/reviews/${first.id}/gallery`, { inGallery: false }))
        .status,
    ).toBe(403);
    const mk = clients.get('MARKETER')!;
    res = await mk.send('patch', `/v1/admin/reviews/${first.id}/gallery`, { inGallery: false });
    expect(res.body.inGallery).toBe(false);
    expect(
      await prisma.auditLog.count({
        where: {
          action: { in: ['review.gallery', 'review.gallery_reorder', 'review.before_upload'] },
        },
      }),
    ).toBeGreaterThanOrEqual(5);
  });
});
