import { type AdminProductDto, STAFF_ROLES, type StaffRole } from '@forest/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env';
import { FilesService } from '../src/files/files.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { type AdminClient, createAdminTestApp, signedIn } from './admin-helpers';

/** S3 stand-in: objects kept in memory, URLs like the real public bucket. */
class MemoryFiles extends FilesService {
  readonly objects = new Map<string, Buffer>();
  override async put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
  }
  override async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

/** PNG signature + IHDR (all `imageMeta` reads). */
function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
}

const IKPU = '03209001001000000';
const run = Date.now().toString(36);
const slug = (tag: string) => `t-adm-${tag}-${run}`;

describe('admin products A11 (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let files: MemoryFiles;
  const clients = new Map<StaffRole, AdminClient>();
  let owner: AdminClient;
  let moyskladBefore: { status: string; config: unknown } | null;

  beforeAll(async () => {
    app = await createAdminTestApp([], {}, (b) =>
      b
        .overrideProvider(FilesService)
        .useFactory({ factory: (env: Env) => new MemoryFiles(env), inject: [ENV] }),
    );
    prisma = app.get(PrismaService);
    files = app.get(FilesService) as MemoryFiles;
    for (const role of STAFF_ROLES) clients.set(role, (await signedIn(app, role)).client);
    owner = clients.get('OWNER')!;
    const row = await prisma.integration.findUnique({ where: { key: 'moysklad' } });
    moyskladBefore = row ? { status: row.status, config: row.config } : null;
  });

  afterAll(async () => {
    // Shared seeded DB: leave the catalog exactly as the storefront suites expect it.
    const mine = await prisma.product.findMany({
      where: { slug: { startsWith: 't-adm-' } },
      select: { id: true },
    });
    const ids = mine.map((p) => p.id);
    await prisma.cartItem.deleteMany({ where: { variant: { productId: { in: ids } } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
    await prisma.redirect.deleteMany({ where: { from: { contains: '/p/t-adm-' } } });
    await prisma.seoMeta.deleteMany({ where: { path: { startsWith: '/p/t-adm-' } } });
    if (moyskladBefore)
      await prisma.integration.update({
        where: { key: 'moysklad' },
        data: {
          status: moyskladBefore.status as 'DISCONNECTED',
          config: moyskladBefore.config ?? {},
        },
      });
    else await prisma.integration.deleteMany({ where: { key: 'moysklad' } });
    await app.close();
  });

  const create = async (tag: string, extra: object = {}) => {
    const res = await owner.post('/v1/admin/products', {
      name: { uz: `Sinov ${tag}`, ru: `Тест ${tag}` },
      slug: slug(tag),
      ...extra,
    });
    expect(res.status).toBe(201);
    return res.body as AdminProductDto;
  };
  const addVariant = async (productId: string, body: object) => {
    const res = await owner.post(`/v1/admin/products/${productId}/variants`, {
      label: { uz: '1 L', ru: '1 л' },
      priceSoum: 100_000,
      ...body,
    });
    return res;
  };

  describe('RBAC per role (docs/02 "Product content, images, SEO")', () => {
    const table: [StaffRole, number, number][] = [
      ['OWNER', 200, 201],
      ['MANAGER', 200, 201],
      ['MARKETER', 200, 201],
      ['OPERATOR', 200, 403],
      ['WAREHOUSE', 200, 403],
    ];
    for (const [role, view, edit] of table) {
      it(`${role}: list ${view}, create ${edit}`, async () => {
        const c = clients.get(role)!;
        expect((await c.get('/v1/admin/products')).status).toBe(view);
        expect((await c.get('/v1/admin/products/meta')).status).toBe(view);
        const res = await c.post('/v1/admin/products', {
          name: { uz: `Rol ${role}`, ru: `Роль ${role}` },
          slug: slug(`role-${role.toLowerCase()}`),
        });
        expect(res.status).toBe(edit);
      });
    }
  });

  it('lists the seeded catalog with KPIs; the IKPU placeholder counts as missing', async () => {
    const meta = await owner.get('/v1/admin/products/meta');
    expect(meta.status).toBe(200);
    expect(meta.body.kpis.activeProducts).toBeGreaterThanOrEqual(8);
    expect(meta.body.kpis.missingIkpuVariants).toBeGreaterThanOrEqual(14);
    expect(meta.body.kpis).not.toHaveProperty('feedsConnected');
    expect(meta.body.locks).toEqual({ source: 'local', price: false, stock: false });
    expect(meta.body.seller).toEqual({ name: 'Forest', isOfficial: true });

    const list = await owner.get('/v1/admin/products?limit=3');
    expect(list.body.items).toHaveLength(3);
    expect(list.body.items[0].sku).toBe('FR-CW');
    expect(list.body.items[0].priceFromSoum).toBe(189000);
    expect(list.body.items[0].missingIkpu).toBe(3);
    const next = await owner.get(`/v1/admin/products?limit=3&cursor=${list.body.nextCursor}`);
    expect(next.body.items[0].id).not.toBe(list.body.items[0].id);

    const bySku = await owner.get('/v1/admin/products?q=fr-wx');
    expect(bySku.body.items.map((p: { sku: string }) => p.sku)).toEqual(['FR-WX']);
    const byName = await owner.get(`/v1/admin/products?q=${encodeURIComponent('мебел')}`);
    expect(byName.body.items.length).toBeGreaterThan(0);
    const byCategory = await owner.get('/v1/admin/products?category=toplamlar');
    expect(byCategory.body.items).toHaveLength(2);
  });

  it('create → variants (so’m → tiyin) → IKPU-before-ACTIVE → storefront shows the edit', async () => {
    const p = await create('life');
    expect(p.status).toBe('DRAFT');
    expect(p.seller.name).toBe('Forest');

    // No active variant yet.
    let res = await owner.send('patch', `/v1/admin/products/${p.id}`, { status: 'ACTIVE' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRODUCT_LAST_VARIANT');

    res = await addVariant(p.id, { sku: `t-${run}-1l`, priceSoum: 123_000, stock: 7 });
    expect(res.status).toBe(201);
    const variant = (res.body as AdminProductDto).variants[0]!;
    expect(variant.sku).toBe(`T-${run.toUpperCase()}-1L`);
    expect(variant.ikpuMissing).toBe(true);
    const row = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(row.priceTiyin).toBe(12_300_000n);

    res = await owner.send('patch', `/v1/admin/products/${p.id}`, { status: 'ACTIVE' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRODUCT_IKPU_REQUIRED');
    expect(res.body.error.message).toContain(variant.sku);

    // The seed placeholder is not a real IKPU either.
    await owner.send('patch', `/v1/admin/products/variants/${variant.id}`, {
      ikpu: '00000000000000000',
    });
    res = await owner.send('patch', `/v1/admin/products/${p.id}`, { status: 'ACTIVE' });
    expect(res.body.error.code).toBe('PRODUCT_IKPU_REQUIRED');

    res = await owner.send('patch', `/v1/admin/products/variants/${variant.id}`, { ikpu: IKPU });
    expect(res.status).toBe(200);
    res = await owner.send('patch', `/v1/admin/products/${p.id}`, {
      status: 'ACTIVE',
      shortDesc: { uz: 'Qisqa tavsif', ru: 'Краткое описание' },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');

    // An active variant of an ACTIVE product can't lose its IKPU (nor be the last one off).
    res = await owner.send('patch', `/v1/admin/products/variants/${variant.id}`, { ikpu: '' });
    expect(res.body.error.code).toBe('PRODUCT_IKPU_REQUIRED');
    res = await owner.send('patch', `/v1/admin/products/variants/${variant.id}`, { active: false });
    expect(res.body.error.code).toBe('PRODUCT_LAST_VARIANT');

    // compare-at must be above the price.
    res = await owner.send('patch', `/v1/admin/products/variants/${variant.id}`, {
      compareAtSoum: 100_000,
    });
    expect(res.body.error.code).toBe('VALIDATION_FAILED');

    res = await owner.send('patch', `/v1/admin/products/${p.id}`, {
      name: { uz: 'Yangi nom', ru: 'Новое имя' },
    });
    expect(res.status).toBe(200);
    res = await owner.send('patch', `/v1/admin/products/variants/${variant.id}`, {
      priceSoum: 150_000,
    });
    expect(res.status).toBe(200);

    const shop = await request(app.getHttpServer())
      .get(`/v1/catalog/products/${p.slug}`)
      .set('Accept-Language', 'uz')
      .expect(200);
    expect(shop.body.name).toBe('Yangi nom');
    expect(shop.body.variants[0].priceSoum).toBe(150_000);

    const audit = await prisma.auditLog.findMany({
      where: { OR: [{ entityId: p.id }, { entityId: variant.id }] },
      select: { action: true },
    });
    const actions = audit.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'product.create',
        'variant.create',
        'variant.update',
        'product.update',
      ]),
    );
    const priceRow = await prisma.auditLog.findFirst({
      where: { entityId: variant.id, action: 'variant.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(priceRow?.before).toEqual({ priceSoum: 123_000 });
    expect(priceRow?.after).toEqual({ priceSoum: 150_000 });
  });

  it('rejects duplicate SKUs and slugs', async () => {
    const p = await create('dup');
    const res = await addVariant(p.id, { sku: 'FR-CW-1000' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRODUCT_SKU_TAKEN');
    const slugRes = await owner.send('patch', `/v1/admin/products/${p.id}`, {
      slug: 'chalk-white',
    });
    expect(slugRes.body.error.code).toBe('PRODUCT_SLUG_TAKEN');
  });

  it('slug change writes 301s per locale, re-points older ones and moves SEO rows', async () => {
    const p = await create('slug-a');
    let res = await owner.send('patch', `/v1/admin/products/${p.id}`, {
      seo: {
        uz: { title: 'Sinov sarlavha', description: 'Tavsif' },
        ru: { title: '', description: '' },
      },
    });
    expect(res.body.seo.uz.title).toBe('Sinov sarlavha');
    expect(res.body.seo.ru.effectiveTitle).toBe('Тест slug-a — цена, купить | Forest');

    res = await owner.send('patch', `/v1/admin/products/${p.id}`, { slug: slug('slug-b') });
    expect(res.status).toBe(200);
    res = await owner.send('patch', `/v1/admin/products/${p.id}`, { slug: slug('slug-c') });
    expect(res.body.slug).toBe(slug('slug-c'));
    expect(res.body.seo.uz.title).toBe('Sinov sarlavha');

    for (const l of ['uz', 'ru']) {
      for (const old of ['slug-a', 'slug-b']) {
        const r = await request(app.getHttpServer())
          .get(`/v1/seo/redirect?path=/${l}/p/${slug(old)}`)
          .expect(200);
        expect(r.body).toEqual({ to: `/${l}/p/${slug('slug-c')}`, code: 301 });
      }
    }
    // Going back to an old slug removes the redirect that would shadow it.
    res = await owner.send('patch', `/v1/admin/products/${p.id}`, { slug: slug('slug-a') });
    expect(res.status).toBe(200);
    const shadow = await prisma.redirect.findUnique({ where: { from: `/uz/p/${slug('slug-a')}` } });
    expect(shadow).toBeNull();
  });

  it('keeps search keywords across saves and rebuilds the search text', async () => {
    const p = await create('kw');
    let res = await owner.send('patch', `/v1/admin/products/${p.id}`, {
      keywords: ['Kraska', 'краска'],
    });
    expect(res.body.keywords).toEqual(['kraska']);
    res = await owner.send('patch', `/v1/admin/products/${p.id}`, {
      name: { uz: 'Boshqa nom', ru: 'Другое имя' },
    });
    expect(res.body.keywords).toEqual(['kraska']);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.searchText).toContain('boshqa nom');
    expect(row.searchText).toContain('kraska');
    expect(row.searchText).not.toContain('sinov');
  });

  it('uploads images (magic bytes, size), orders, edits alt and deletes them', async () => {
    const p = await create('img');
    const upload = (buf: Buffer, name = 'a.png') =>
      owner.agent
        .post(`/v1/admin/products/${p.id}/images`)
        .set('X-Forwarded-For', owner.ip)
        .set('X-CSRF-Token', owner.csrf ?? '')
        .attach('file', buf, name);

    let res = await upload(png(1200, 800));
    expect(res.status).toBe(201);
    res = await upload(png(640, 480), 'b.png');
    const images = (res.body as AdminProductDto).images;
    expect(images.map((i) => [i.width, i.height])).toEqual([
      [1200, 800],
      [640, 480],
    ]);
    expect(images[0]!.url).toMatch(/^http:\/\/cdn\.test\/forest-public\/products\//);
    expect(files.objects.size).toBeGreaterThanOrEqual(2);

    const bad = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.png');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('FILE_TYPE_UNSUPPORTED');
    const noCsrf = await owner.agent
      .post(`/v1/admin/products/${p.id}/images`)
      .set('X-Forwarded-For', owner.ip)
      .attach('file', png(10, 10), 'c.png');
    expect(noCsrf.status).toBe(403);

    res = await owner.send('put', `/v1/admin/products/${p.id}/images/order`, {
      ids: [images[1]!.id, images[0]!.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.images.map((i: { id: string }) => i.id)).toEqual([
      images[1]!.id,
      images[0]!.id,
    ]);

    res = await owner.send('patch', `/v1/admin/products/images/${images[0]!.id}`, {
      alt: { uz: 'Komod', ru: 'Комод' },
    });
    expect(res.body.images.find((i: { id: string }) => i.id === images[0]!.id).alt.ru).toBe(
      'Комод',
    );

    const key = (await prisma.file.findUniqueOrThrow({ where: { id: images[0]!.fileId } })).key;
    res = await owner.send('delete', `/v1/admin/products/images/${images[0]!.id}`);
    expect(res.status).toBe(200);
    expect(res.body.images).toHaveLength(1);
    expect(await prisma.file.findUnique({ where: { id: images[0]!.fileId } })).toBeNull();
    expect(files.objects.has(key)).toBe(false);

    const audit = await prisma.auditLog.findMany({
      where: { entityId: p.id, action: { startsWith: 'product.image_' } },
    });
    expect(audit.map((a) => a.action).sort()).toEqual([
      'product.image_add',
      'product.image_add',
      'product.image_delete',
      'product.image_reorder',
      'product.image_update',
    ]);
  });

  it('respects the MoySklad locks separately for price, stock and the variant list', async () => {
    const p = await create('ms');
    const v = (await addVariant(p.id, { sku: `t-${run}-ms`, stock: 5 })).body.variants[0];
    await prisma.integration.upsert({
      where: { key: 'moysklad' },
      create: {
        key: 'moysklad',
        status: 'CONNECTED',
        config: { flows: { products: false, prices: true, stock: false } },
      },
      update: {
        status: 'CONNECTED',
        config: { flows: { products: false, prices: true, stock: false } },
      },
    });
    let res = await owner.get('/v1/admin/products/meta');
    expect(res.body.locks).toEqual({ source: 'local', price: true, stock: false });
    res = await owner.send('patch', `/v1/admin/products/variants/${v.id}`, { priceSoum: 1 });
    expect(res.body.error.code).toBe('CATALOG_MOYSKLAD_READONLY');
    res = await owner.send('patch', `/v1/admin/products/variants/${v.id}`, {
      stock: 9,
      ikpu: IKPU,
    });
    expect(res.status).toBe(200);
    expect(res.body.variants[0].stock).toBe(9);
    // Unchanged price in the payload is fine (the editor sends the whole row).
    res = await owner.send('patch', `/v1/admin/products/variants/${v.id}`, { priceSoum: 100_000 });
    expect(res.status).toBe(200);

    await prisma.integration.update({
      where: { key: 'moysklad' },
      data: { config: { flows: { products: true, prices: false, stock: true } } },
    });
    res = await owner.send('patch', `/v1/admin/products/variants/${v.id}`, { stock: 1 });
    expect(res.body.error.code).toBe('CATALOG_MOYSKLAD_READONLY');
    res = await addVariant(p.id, { sku: `t-${run}-ms2` });
    expect(res.body.error.code).toBe('CATALOG_MOYSKLAD_READONLY');
    res = await owner.send('delete', `/v1/admin/products/variants/${v.id}`);
    expect(res.body.error.code).toBe('CATALOG_MOYSKLAD_READONLY');
    res = await owner.get(`/v1/admin/products/${p.id}`);
    expect(res.body.locks).toEqual({ source: 'moysklad', price: false, stock: true });

    // A variant linked to MoySklad: its SKU and active flag belong to the reconcile.
    await prisma.variant.update({ where: { id: v.id }, data: { moyskladId: `ms-${run}` } });
    res = await owner.send('patch', `/v1/admin/products/variants/${v.id}`, { sku: `t-${run}-x` });
    expect(res.body.error).toMatchObject({ code: 'CATALOG_MOYSKLAD_READONLY', field: 'sku' });
    res = await owner.send('patch', `/v1/admin/products/variants/${v.id}`, { active: false });
    expect(res.body.error).toMatchObject({ code: 'CATALOG_MOYSKLAD_READONLY', field: 'active' });
    res = await owner.send('patch', `/v1/admin/products/variants/${v.id}`, {
      sku: v.sku,
      active: true,
      label: { uz: '1 litr', ru: '1 литр' },
    });
    expect(res.status).toBe(200);
    // Deleting a MoySklad import would only bring it back, without our content.
    res = await owner.send('delete', `/v1/admin/products/${p.id}`);
    expect(res.body.error.code).toBe('CATALOG_MOYSKLAD_READONLY');

    await prisma.integration.update({
      where: { key: 'moysklad' },
      data: { status: 'DISCONNECTED', config: {} },
    });
  });

  it('relations, delete rules and validation', async () => {
    const a = await create('rel-a');
    const b = await create('rel-b');
    let res = await owner.send('put', `/v1/admin/products/${a.id}/relations`, {
      kind: 'UPSELL',
      productIds: [b.id, a.id],
    });
    expect(res.body.relations.UPSELL.map((r: { id: string }) => r.id)).toEqual([b.id]);

    const seeded = await prisma.product.findUniqueOrThrow({ where: { slug: 'chalk-white' } });
    res = await owner.send('delete', `/v1/admin/products/${seeded.id}`);
    expect(res.body.error.code).toBe('PRODUCT_DELETE_NOT_DRAFT');
    res = await owner.send('delete', `/v1/admin/products/${b.id}`);
    expect(res.status).toBe(204);
    expect(await prisma.product.findUnique({ where: { id: b.id } })).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { entityId: b.id, action: 'product.delete' } }),
    ).toBe(1);

    res = await owner.send('patch', `/v1/admin/products/${a.id}`, { badges: ['NOPE'] });
    expect(res.status).toBe(400);
    res = await owner.send('patch', `/v1/admin/products/${a.id}`, {
      seo: { uz: { title: 'x'.repeat(61), description: '' }, ru: { title: '', description: '' } },
    });
    expect(res.status).toBe(400);
  });

  it('active variants need a price ≥ 1 so’m; compare-at edits keep the exact price', async () => {
    const p = await create('price');
    let res = await addVariant(p.id, { sku: `t-${run}-p0`, priceSoum: 0, ikpu: IKPU });
    expect(res.body.error).toMatchObject({ code: 'PRODUCT_PRICE_REQUIRED', field: 'priceSoum' });
    res = await addVariant(p.id, { sku: `t-${run}-p0`, priceSoum: 0, ikpu: IKPU, active: false });
    expect(res.status).toBe(201);
    const v = res.body.variants[0];
    res = await owner.send('patch', `/v1/admin/products/variants/${v.id}`, { active: true });
    expect(res.body.error.code).toBe('PRODUCT_PRICE_REQUIRED');
    // A price with tiyin (MoySklad) is never rewritten by an edit of another field.
    await prisma.variant.update({
      where: { id: v.id },
      data: { priceTiyin: 12_345_678n, active: true },
    });
    res = await owner.send('patch', `/v1/admin/products/variants/${v.id}`, {
      priceSoum: 123_457,
      compareAtSoum: 150_000,
    });
    expect(res.status).toBe(200);
    const row = await prisma.variant.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.priceTiyin).toBe(12_345_678n);
    expect(row.compareAtTiyin).toBe(15_000_000n);
    // Activation checks every active variant's price.
    await prisma.variant.update({ where: { id: v.id }, data: { priceTiyin: 0n } });
    res = await owner.send('patch', `/v1/admin/products/${p.id}`, { status: 'ACTIVE' });
    expect(res.body.error.code).toBe('PRODUCT_PRICE_REQUIRED');
  });

  it('video URLs must be https', async () => {
    const p = await create('video');
    for (const videoUrl of ['javascript:alert(1)', 'data:text/html,x', 'http://youtu.be/x']) {
      const res = await owner.send('patch', `/v1/admin/products/${p.id}`, { videoUrl });
      expect(res.status, videoUrl).toBe(400);
    }
    const ok = await owner.send('patch', `/v1/admin/products/${p.id}`, {
      videoUrl: 'https://youtu.be/abc',
    });
    expect(ok.body.videoUrl).toBe('https://youtu.be/abc');
  });

  it('slug change follows the home hero card; deleting a draft stops its gift codes', async () => {
    const p = await create('hero');
    const setting = await prisma.setting.findUniqueOrThrow({ where: { key: 'home.media' } });
    const original = setting.value as { hero: { productSlug: string | null } | null };
    try {
      await prisma.setting.update({
        where: { key: 'home.media' },
        data: {
          value: {
            ...(original as object),
            hero: {
              beforeKey: 'b.jpg',
              afterKey: 'a.jpg',
              alt: { uz: '', ru: '' },
              ...(original.hero ?? {}),
              productSlug: p.slug,
            },
          },
        },
      });
      const res = await owner.send('patch', `/v1/admin/products/${p.id}`, {
        slug: slug('hero-new'),
      });
      expect(res.status).toBe(200);
      const after = await prisma.setting.findUniqueOrThrow({ where: { key: 'home.media' } });
      expect((after.value as { hero: { productSlug: string } }).hero.productSlug).toBe(
        slug('hero-new'),
      );
      const audit = await prisma.auditLog.findFirst({
        where: { entityId: p.id, action: 'product.update' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.after).toMatchObject({ homeHeroSlug: slug('hero-new') });
    } finally {
      await prisma.setting.update({
        where: { key: 'home.media' },
        data: { value: setting.value ?? {} },
      });
    }

    const g = await create('gift');
    const gv = (await addVariant(g.id, { sku: `t-${run}-gift` })).body.variants[0];
    const promo = await prisma.promoCode.create({
      data: {
        code: `TGIFT${run.toUpperCase()}`.slice(0, 32),
        type: 'GIFT',
        value: 0,
        giftVariantId: gv.id,
      },
    });
    try {
      const res = await owner.send('delete', `/v1/admin/products/${g.id}`);
      expect(res.status).toBe(204);
      const after = await prisma.promoCode.findUniqueOrThrow({ where: { id: promo.id } });
      expect(after).toMatchObject({ giftVariantId: null, active: false });
    } finally {
      await prisma.promoCode.delete({ where: { id: promo.id } });
    }
  });
});
