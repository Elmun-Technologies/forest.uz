import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  AdminArticleDto,
  AiProductDescriptionDraftDto,
  AiReplyDraftDto,
  AiSeoDraftDto,
  ApiKeyCreatedDto,
  ArticleDto,
  ArticleListDto,
  WebhookListDto,
  WebhookSecretDto,
  WebhookTestResultDto,
} from '@forest/contracts';
import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Queue } from 'bullmq';
import { Prisma } from '@forest/db';
import request from 'supertest';
import { ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env';
import { FilesService } from '../src/files/files.service';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { WebhookCollector } from '../src/webhooks-out/collector.service';
import { WebhookSender } from '../src/webhooks-out/sender.service';
import { verifyWebhookSignature } from '../src/webhooks-out/signature';
import { WEBHOOKS_QUEUE } from '../src/webhooks-out/webhooks.module';
import { type AdminClient, createAdminTestApp, signedIn } from './admin-helpers';
import { nextTestIp } from './app';

/** S3 stand-in for CMS uploads. */
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

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

/** Local webhook receiver; `status` decides the answer. */
async function receiver(): Promise<{
  url: string;
  got: Received[];
  status: { code: number };
  server: Server;
}> {
  const got: Received[] = [];
  const status = { code: 200 };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      got.push({ headers: req.headers, body });
      res.statusCode = status.code;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/hook`, got, status, server };
}

const run = Date.now().toString(36);

describe('phase 5C: webhooks, API keys, CMS, AI drafts (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let queue: Queue;
  let owner: AdminClient;
  let manager: AdminClient;
  let marketer: AdminClient;
  let operator: AdminClient;
  let hook: Awaited<ReturnType<typeof receiver>>;
  const customerIds: string[] = [];
  const endpointIds: string[] = [];
  const apiKeyIds: string[] = [];
  const conversationIds: string[] = [];
  let brandBefore: unknown[] = [];
  let claudeConfig: Prisma.InputJsonValue | null = null;

  beforeAll(async () => {
    app = await createAdminTestApp([], {}, (b) =>
      b
        .overrideProvider(FilesService)
        .useFactory({ factory: (env: Env) => new MemoryFiles(env), inject: [ENV] }),
    );
    prisma = app.get(PrismaService);
    // The test drives collect/send itself (no background runs racing the assertions).
    queue = app.get<Queue>(getQueueToken(WEBHOOKS_QUEUE));
    await queue.pause();
    owner = (await signedIn(app, 'OWNER')).client;
    manager = (await signedIn(app, 'MANAGER')).client;
    marketer = (await signedIn(app, 'MARKETER')).client;
    operator = (await signedIn(app, 'OPERATOR')).client;
    hook = await receiver();
    brandBefore = await prisma.page.findMany({ where: { kind: 'PAGE', slug: 'brend' } });
    claudeConfig =
      (await prisma.integration.findUnique({ where: { key: 'claude' } }))?.config ?? null;
  });

  afterAll(async () => {
    await prisma.webhookEndpoint.deleteMany({ where: { id: { in: endpointIds } } });
    await prisma.apiKey.deleteMany({ where: { id: { in: apiKeyIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
    await prisma.order.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.page.deleteMany({ where: { kind: 'ARTICLE', slug: { contains: run } } });
    await prisma.seoMeta.deleteMany({ where: { path: { contains: run } } });
    await prisma.redirect.deleteMany({ where: { from: { contains: run } } });
    // Brend story: restore exactly what was there.
    await prisma.page.deleteMany({ where: { kind: 'PAGE', slug: 'brend' } });
    for (const p of brandBefore as Parameters<typeof prisma.page.create>[0]['data'][])
      await prisma.page.create({ data: p });
    await prisma.integration.updateMany({
      where: { key: 'claude' },
      data: { config: claudeConfig ?? Prisma.DbNull },
    });
    await queue.resume();
    hook.server.close();
    await app.close();
  });

  async function newCustomer(tag: string) {
    const c = await prisma.customer.create({
      data: {
        phone: `+99890${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
        name: `Aziza ${tag}`,
      },
    });
    customerIds.push(c.id);
    return c;
  }

  /** Earlier tests' endpoints are switched off so each test sees only its own deliveries. */
  async function createEndpoint(events: string[], url = hook.url) {
    await prisma.webhookEndpoint.updateMany({
      where: { id: { in: endpointIds } },
      data: { active: false },
    });
    const res = await owner.post('/v1/admin/webhooks', { name: `t-${run}`, url, events });
    expect(res.status).toBe(201);
    const body = res.body as WebhookSecretDto;
    endpointIds.push(body.endpoint.id);
    return body;
  }

  // ───────── webhooks ─────────

  it('only the Owner manages webhooks; the Manager sees them without secrets', async () => {
    const denied = await manager.post('/v1/admin/webhooks', {
      url: hook.url,
      events: ['order.created'],
    });
    expect(denied.status).toBe(403);
    const created = await createEndpoint(['customer.created']);
    expect(created.secret).toMatch(/^whsec_/);
    const row = await prisma.webhookEndpoint.findUniqueOrThrow({
      where: { id: created.endpoint.id },
    });
    expect(Buffer.from(row.secret).toString('utf8')).not.toContain(created.secret);
    const list = await manager.get('/v1/admin/webhooks');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(created.secret);
    expect((list.body as WebhookListDto).items.some((i) => i.id === created.endpoint.id)).toBe(
      true,
    );
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'webhook.create', entityId: created.endpoint.id },
    });
    expect(JSON.stringify(audit)).not.toContain(created.secret);
  });

  it('collects committed events once and delivers them signed, without PII', async () => {
    const { endpoint, secret } = await createEndpoint([
      'customer.created',
      'order.status_changed',
      'order.shipped',
    ]);
    hook.got.length = 0;
    const customer = await newCustomer('wh');
    const order = await prisma.order.create({
      data: {
        publicId: `wh-${customer.id}`,
        trackingToken: `wh-${customer.id}`,
        customerId: customer.id,
        status: 'HANDED_TO_COURIER',
        contactName: 'Aziza Karimova',
        contactPhone: customer.phone!,
        address: { region: 'tashkent', district: 'yunusobod', line: 'Amir Temur 1' },
        subtotalTiyin: 50_000_000n,
        totalTiyin: 50_000_000n,
        paymentMethod: 'COD',
        deliveryZone: 'tashkent',
        carrier: 'YANDEX',
        offerVersion: '1',
      },
    });
    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        type: 'STATUS_CHANGED',
        from: 'READY',
        to: 'HANDED_TO_COURIER',
        actorType: 'STAFF',
      },
    });
    const collector = app.get(WebhookCollector);
    await collector.collect();
    await collector.collect(); // re-read of the lookback window: no duplicates
    const rows = await prisma.webhookDelivery.findMany({ where: { endpointId: endpoint.id } });
    expect(rows.map((r) => r.event).sort()).toEqual([
      'customer.created',
      'order.shipped',
      'order.status_changed',
    ]);

    await app.get(WebhookSender).sendDue();
    expect(hook.got).toHaveLength(3);
    for (const g of hook.got) {
      expect(
        verifyWebhookSignature(secret, g.headers['x-forest-signature'] as string, g.body),
      ).toBe(true);
      expect(g.body).not.toMatch(/Aziza|Karimova|Amir Temur|998\d{9}/);
    }
    const shipped = hook.got.find((g) => g.headers['x-forest-event'] === 'order.shipped')!;
    const env = JSON.parse(shipped.body) as { id: string; type: string; data: { number: string } };
    expect(env.type).toBe('order.shipped');
    expect(env.data.number).toBe(order.number);
    expect(shipped.headers['x-forest-delivery']).toBe(env.id);
    const delivered = await prisma.webhookDelivery.count({
      where: { endpointId: endpoint.id, status: 'DELIVERED' },
    });
    expect(delivered).toBe(3);
    const list = (await owner.get('/v1/admin/webhooks')).body as WebhookListDto;
    expect(list.items.find((i) => i.id === endpoint.id)!.stats24h.delivered).toBe(3);
  });

  it('retries with backoff, fails after 8 attempts and auto-disables a dead endpoint', async () => {
    const { endpoint } = await createEndpoint(['customer.created']);
    hook.status.code = 500;
    await newCustomer('retry');
    await app.get(WebhookCollector).collect();
    const sender = app.get(WebhookSender);
    const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: endpoint.id } });
    await prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { consecutiveFailures: 4 },
    });
    const started = Date.now();
    await sender.sendDue();
    let row = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastStatusCode: 500 });
    const wait = row.nextAttemptAt!.getTime() - started;
    expect(wait).toBeGreaterThanOrEqual(29_000);
    expect(wait).toBeLessThan(40_000);
    for (let i = 2; i <= 8; i++) {
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { nextAttemptAt: new Date(0) },
      });
      await sender.sendDue();
    }
    row = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(row).toMatchObject({ status: 'FAILED', attempts: 8, nextAttemptAt: null });
    const ep = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } });
    expect(ep).toMatchObject({ active: false, consecutiveFailures: 5 });
    expect(ep.disabledAt).not.toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { action: 'webhook.auto_disabled', entityId: endpoint.id },
      }),
    ).toBe(1);
    hook.status.code = 200;

    // Re-enabling resets the counter; redelivery starts again from attempt 1.
    const re = await owner.send('patch', `/v1/admin/webhooks/${endpoint.id}`, { active: true });
    expect(re.body).toMatchObject({ active: true, consecutiveFailures: 0, disabledAt: null });
    const redo = await owner.post(`/v1/admin/webhooks/${endpoint.id}/deliveries/${d.id}/redeliver`);
    expect(redo.status).toBe(200);
    await sender.sendDue();
    row = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(row).toMatchObject({ status: 'DELIVERED', attempts: 1 });
  });

  it('sends a test delivery at once and lists the delivery log', async () => {
    const { endpoint, secret } = await createEndpoint(['order.created']);
    hook.got.length = 0;
    const res = await owner.post(`/v1/admin/webhooks/${endpoint.id}/test`);
    expect(res.status).toBe(200);
    const body = res.body as WebhookTestResultDto;
    expect(body).toMatchObject({ ok: true, statusCode: 200 });
    expect(hook.got[0]!.headers['x-forest-event']).toBe('webhook.test');
    expect(
      verifyWebhookSignature(
        secret,
        hook.got[0]!.headers['x-forest-signature'] as string,
        hook.got[0]!.body,
      ),
    ).toBe(true);
    const log = await manager.get(`/v1/admin/webhooks/${endpoint.id}/deliveries`);
    expect(log.status).toBe(200);
    expect((log.body as { items: { event: string }[] }).items[0]!.event).toBe('webhook.test');
    // Rotation returns a new secret once.
    const rotated = await owner.post(`/v1/admin/webhooks/${endpoint.id}/rotate-secret`);
    expect((rotated.body as WebhookSecretDto).secret).not.toBe(secret);
    expect((await manager.post(`/v1/admin/webhooks/${endpoint.id}/test`)).status).toBe(403);
  });

  it('strict mode: a rebinding host is never connected to', async () => {
    const { endpoint } = await createEndpoint(['customer.created']);
    await prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { url: 'https://hooks.example.test/x' },
    });
    hook.got.length = 0;
    await newCustomer('ssrf');
    await app.get(WebhookCollector).collect();
    const sender = app.get(WebhookSender);
    sender.strictOverride = true;
    sender.resolve = async () => ['127.0.0.1'];
    try {
      await sender.sendDue();
    } finally {
      sender.strictOverride = undefined;
      sender.resolve = undefined;
    }
    const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: endpoint.id } });
    expect(d).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'url not allowed' });
    expect(hook.got).toHaveLength(0);
  });

  // ───────── API keys ─────────

  it('API keys: shown once, hashed, scoped, rate-limited and revocable', async () => {
    expect(
      (await manager.post('/v1/admin/api-keys', { name: 'x', scopes: ['products:read'] })).status,
    ).toBe(403);
    const res = await owner.post('/v1/admin/api-keys', {
      name: `n8n ${run}`,
      scopes: ['products:read'],
      rateLimitPerMin: 3,
    });
    expect(res.status).toBe(201);
    const created = res.body as ApiKeyCreatedDto;
    apiKeyIds.push(created.key.id);
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.key.id } });
    expect(row.keyHash).not.toContain(created.secret);
    expect(JSON.stringify((await manager.get('/v1/admin/api-keys')).body)).not.toContain(
      created.secret,
    );

    const ip = nextTestIp();
    const call = (path: string, key?: string) => {
      const r = request(app.getHttpServer()).get(path).set('X-Forwarded-For', ip);
      return key ? r.set('Authorization', `Bearer ${key}`) : r;
    };
    expect((await call('/v1/partner/products')).status).toBe(401);
    expect((await call('/v1/partner/products', `${created.secret.slice(0, -1)}x`)).status).toBe(
      401,
    );
    const ok = await call('/v1/partner/products?limit=2', created.secret);
    expect(ok.status).toBe(200);
    expect(ok.headers['x-ratelimit-limit']).toBe('3');
    expect((ok.body as { items: unknown[] }).items.length).toBeGreaterThan(0);
    expect(JSON.stringify(ok.body)).not.toMatch(/ikpu|moyskladId|searchText/i);
    const scope = await call('/v1/partner/stock', created.secret);
    expect(scope.status).toBe(403);
    expect(scope.body.error.code).toBe('API_KEY_SCOPE');
    await call('/v1/partner/products', created.secret);
    await call('/v1/partner/products', created.secret);
    const limited = await call('/v1/partner/products', created.secret);
    expect(limited.status).toBe(429);
    await new Promise((r) => setTimeout(r, 50));
    expect(
      (await prisma.apiKey.findUniqueOrThrow({ where: { id: created.key.id } })).lastUsedAt,
    ).not.toBeNull();

    const revoked = await owner.post(`/v1/admin/api-keys/${created.key.id}/revoke`);
    expect(revoked.body.revokedAt).not.toBeNull();
    expect((await call('/v1/partner/products', created.secret)).status).toBe(401);
  });

  it('stock scope reads sellable stock by SKU', async () => {
    const res = await owner.post('/v1/admin/api-keys', {
      name: `stock ${run}`,
      scopes: ['stock:read'],
    });
    const created = res.body as ApiKeyCreatedDto;
    apiKeyIds.push(created.key.id);
    const v = await prisma.variant.findFirstOrThrow({ where: { product: { status: 'ACTIVE' } } });
    const s = await request(app.getHttpServer())
      .get(`/v1/partner/stock?sku=${v.sku.toLowerCase()}`)
      .set('Authorization', `Bearer ${created.secret}`);
    expect(s.status).toBe(200);
    expect(s.body.items).toEqual([
      expect.objectContaining({ sku: v.sku, available: Math.max(0, v.stock - v.reserved) }),
    ]);
  });

  // ───────── CMS ─────────

  it('CMS: Marketer publishes an article per locale; storefront reads, renames redirect', async () => {
    const slug = `t-ilhom-${run}`;
    expect((await operator.get('/v1/admin/content/articles')).status).toBe(403);
    const upload = await marketer.agent
      .post('/v1/admin/content/images')
      .set('X-Forwarded-For', marketer.ip)
      .set('X-CSRF-Token', marketer.csrf ?? '')
      .attach('file', png(1200, 800), 'c.png');
    expect(upload.status).toBe(201);
    const cover = upload.body as { fileId: string };
    const product = await prisma.product.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    const doc = {
      slug,
      category: 'furniture',
      coverId: cover.fileId,
      readingMinutes: 6,
      relatedProductIds: [product.id],
      uz: {
        title: 'Komodni bo‘yash',
        excerpt: 'Qadamba-qadam',
        published: true,
        seoTitle: 'Komodni bo‘yash | Forest',
        blocks: [
          { type: 'h2', text: 'Tayyorlash' },
          { type: 'p', text: 'Yuzani tozalang.' },
          { type: 'image', fileId: cover.fileId, alt: 'Komod', caption: 'Natija' },
          { type: 'quote', text: 'Bir kunda tayyor', cite: '' },
        ],
      },
      ru: { title: 'Покраска комода', published: false, blocks: [] },
    };
    const created = await marketer.post('/v1/admin/content/articles', doc);
    expect(created.status).toBe(201);
    expect((created.body as AdminArticleDto).locales.uz.seoTitle).toBe('Komodni bo‘yash | Forest');
    expect((await marketer.post('/v1/admin/content/articles', doc)).body.error.code).toBe(
      'PAGE_SLUG_TAKEN',
    );

    const shop = request(app.getHttpServer());
    const list = (await shop.get('/v1/content/articles?locale=uz')).body as ArticleListDto;
    expect(list.items.some((a) => a.slug === slug)).toBe(true);
    expect(list.categories).toContain('furniture');
    const ruList = (await shop.get('/v1/content/articles?locale=ru')).body as ArticleListDto;
    expect(ruList.items.some((a) => a.slug === slug)).toBe(false);
    const article = (await shop.get(`/v1/content/articles/${slug}?locale=uz`)).body as ArticleDto;
    expect(article.blocks.map((b) => b.type)).toEqual(['h2', 'p', 'image', 'quote']);
    expect(article.related[0]!.slug).toBe(product.slug);
    expect(article.cover?.url).toContain('/content/');
    expect((await shop.get(`/v1/content/articles/${slug}?locale=ru`)).status).toBe(404);

    // Unknown file / product references are refused.
    const bad = await marketer.send('put', `/v1/admin/content/articles/${slug}`, {
      ...doc,
      coverId: 'nope',
    });
    expect(bad.body.error.code).toBe('PAGE_FILE_INVALID');

    const renamed = await marketer.send('put', `/v1/admin/content/articles/${slug}`, {
      ...doc,
      slug: `${slug}-v2`,
    });
    expect(renamed.status).toBe(200);
    const redirect = await prisma.redirect.findUnique({ where: { from: `/uz/ilhom/${slug}` } });
    expect(redirect?.to).toBe(`/uz/ilhom/${slug}-v2`);
    expect(await prisma.seoMeta.count({ where: { path: `/ilhom/${slug}-v2` } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'page.update', entityId: `ARTICLE/${slug}-v2` },
      }),
    ).toBe(1);

    const del = await marketer.post(`/v1/admin/content/articles/${slug}-v2/delete`, {
      confirm: `${slug}-v2`,
    });
    expect(del.status).toBe(200);
    expect((await shop.get(`/v1/content/articles/${slug}-v2?locale=uz`)).status).toBe(404);
  });

  it('CMS: Brend story is hidden until published', async () => {
    const shop = request(app.getHttpServer());
    await prisma.page.deleteMany({ where: { kind: 'PAGE', slug: 'brend' } });
    expect((await shop.get('/v1/content/brand?locale=uz')).status).toBe(404);
    const empty = await marketer.get('/v1/admin/content/brand');
    expect(empty.status).toBe(200);
    const saved = await marketer.send('put', '/v1/admin/content/brand', {
      slug: 'brend',
      uz: { title: 'Bizning yo‘l', published: true, blocks: [{ type: 'p', text: 'Tarix' }] },
      ru: { title: '', blocks: [] },
    });
    expect(saved.status).toBe(200);
    const story = await shop.get('/v1/content/brand?locale=uz');
    expect(story.body).toMatchObject({
      title: 'Bizning yo‘l',
      blocks: [{ type: 'p', text: 'Tarix' }],
    });
    expect((await shop.get('/v1/content/brand?locale=ru')).status).toBe(404);
  });

  // ───────── AI drafts (fake provider) ─────────

  it('AI drafts: returned unsaved, audited, permission of the target field', async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    expect(
      (await operator.post('/v1/admin/ai/product-description', { productId: product.id })).status,
    ).toBe(403);
    const res = await marketer.post('/v1/admin/ai/product-description', {
      productId: product.id,
      hint: 'call +998 90 123 45 67',
    });
    expect(res.status).toBe(200);
    const draft = res.body as AiProductDescriptionDraftDto;
    expect(draft.fake).toBe(true);
    expect(draft.shortDesc.uz).toContain('[AI fake]');
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.shortDesc).toEqual(product.shortDesc);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ai.draft', entityId: product.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.after).toMatchObject({ kind: 'product_description', model: 'fake' });

    const seo = await marketer.post('/v1/admin/ai/seo', { path: `/p/${product.slug}` });
    expect(seo.status).toBe(200);
    expect((seo.body as AiSeoDraftDto).ru.title.length).toBeLessThanOrEqual(60);
    expect((await marketer.post('/v1/admin/ai/seo', { path: '/nope/x' })).status).toBe(404);

    const customer = await newCustomer('ai');
    const conv = await prisma.conversation.create({
      data: {
        customerId: customer.id,
        telegramChatId: 1n,
        topic: 'advice',
        messages: {
          create: [
            {
              fromCustomer: true,
              text: 'Men Aziza, Chilonzor 9-kvartal 12-uy',
              createdAt: new Date(Date.now() - 60_000),
            },
            {
              fromCustomer: false,
              text: 'Salom! Qanday yordam beray?',
              createdAt: new Date(Date.now() - 30_000),
            },
            { fromCustomer: true, text: 'Divan uchun qaysi rang?' },
          ],
        },
      },
    });
    conversationIds.push(conv.id);
    // Off by default (customer text would leave Uzbekistan): nobody gets a draft.
    const off = await operator.post('/v1/admin/ai/reply', { conversationId: conv.id });
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('AI_REPLY_DISABLED');
    expect((await operator.get('/v1/admin/ai/status')).body).toMatchObject({ replyDrafts: false });
    // Only the Owner switches it on (audited).
    expect((await manager.send('put', '/v1/admin/ai/settings', { replyDrafts: true })).status).toBe(
      403,
    );
    const on = await owner.send('put', '/v1/admin/ai/settings', { replyDrafts: true });
    expect(on.body).toMatchObject({ replyDrafts: true, available: true });
    expect(
      await prisma.auditLog.count({ where: { action: 'ai.settings.update', entityId: 'claude' } }),
    ).toBeGreaterThan(0);

    expect((await marketer.post('/v1/admin/ai/reply', { conversationId: conv.id })).status).toBe(
      403,
    );
    const provider = await app.get(IntegrationsService).ai();
    const spy = vi.spyOn(provider, 'complete');
    const reply = await operator.post('/v1/admin/ai/reply', { conversationId: conv.id });
    expect(reply.status).toBe(200);
    // Only the latest customer message goes out — not the name/address said earlier.
    const prompt = spy.mock.calls[0]![0].prompt;
    expect(prompt).toContain('Divan uchun qaysi rang?');
    expect(prompt).not.toMatch(/Aziza|Chilonzor|Qanday yordam/);
    spy.mockRestore();
    expect((reply.body as AiReplyDraftDto).locale).toBe('uz');
  });
});
