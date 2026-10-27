import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  AdminNotFoundDto,
  AdminRedirectDto,
  AdminSearchQueriesDto,
  AdminSeoOverviewDto,
  AdminSeoPageDto,
  AdminSeoPagesDto,
  PublicSettingsDto,
  StaffRole,
} from '@forest/contracts';
import type { Prisma } from '@forest/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { revalidateKey, verifyRevalidate } from '../src/seo/revalidate-signature';
import { SearchQueriesService } from '../src/seo/search-queries.service';
import { WebRevalidateService } from '../src/seo/web-revalidate.service';
import { type AdminClient, createAdminTestApp, signedIn } from './admin-helpers';

/** A stand-in for the storefront's `POST /api/revalidate`: records verified tag lists. */
function webStub() {
  const calls: { tags: string[]; verified: boolean }[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const key = revalidateKey(process.env.APP_ENCRYPTION_KEY!);
      const verified = verifyRevalidate(key, req.headers['x-forest-signature'] as string, body);
      calls.push({ tags: (JSON.parse(body) as { tags: string[] }).tags, verified });
      res.writeHead(verified ? 200 : 401).end('{}');
    });
  });
  return { calls, server };
}

async function put(c: AdminClient, path: string, body: object) {
  if (!c.csrf) await c.get('/v1/admin/auth/csrf');
  return c.agent.put(path).set('X-Forwarded-For', c.ip).set('X-CSRF-Token', c.csrf!).send(body);
}

describe('admin SEO center A9 (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let web: WebRevalidateService;
  const stub = webStub();
  const clients = new Map<StaffRole, AdminClient>();
  let saved: { key: string; value: Prisma.JsonValue }[] = [];
  const http = () => request(app.getHttpServer());
  const owner = () => clients.get('OWNER')!;
  const lastAudit = (action: string) =>
    prisma.auditLog.findFirst({ where: { action }, orderBy: { createdAt: 'desc' } });

  beforeAll(async () => {
    await new Promise<void>((r) => stub.server.listen(0, '127.0.0.1', r));
    const port = (stub.server.address() as AddressInfo).port;
    app = await createAdminTestApp([], { WEB_INTERNAL_URL: `http://127.0.0.1:${port}` });
    prisma = app.get(PrismaService);
    web = app.get(WebRevalidateService);
    for (const role of ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE', 'MARKETER'] as const)
      clients.set(role, (await signedIn(app, role)).client);
    saved = await prisma.setting.findMany({
      where: { key: { in: ['seo.verification', 'seo.robots', 'seo.schema', 'seo.indexnow'] } },
      select: { key: true, value: true },
    });
  });

  afterAll(async () => {
    for (const s of saved)
      await prisma.setting.update({
        where: { key: s.key },
        data: { value: s.value as Prisma.InputJsonValue },
      });
    await prisma.seoMeta.deleteMany({
      where: { path: { in: ['/p/chalk-white', '/', '/katalog'] } },
    });
    await prisma.redirect.deleteMany({ where: { from: { startsWith: '/uz/t-seo-' } } });
    await prisma.notFoundLog.deleteMany({ where: { path: { startsWith: '/uz/p/chalk-whit' } } });
    await prisma.searchQueryDaily.deleteMany({ where: { query: { startsWith: 't-seo ' } } });
    await app.close();
    await new Promise((r) => stub.server.close(r));
  });

  it('RBAC: seo.edit (Owner, Manager, Marketer) sees and edits A9', async () => {
    for (const [role, status] of [
      ['OWNER', 200],
      ['MANAGER', 200],
      ['MARKETER', 200],
      ['OPERATOR', 403],
      ['WAREHOUSE', 403],
    ] as const) {
      expect((await clients.get(role)!.get('/v1/admin/seo/overview')).status).toBe(status);
    }
    const o = (await owner().get('/v1/admin/seo/overview')).body as AdminSeoOverviewDto;
    expect(o.health.score).toBeGreaterThanOrEqual(0);
    expect(o.health.pages).toBeGreaterThan(10);
    expect(o.indexNow.keyFileUrl).toMatch(/\/[0-9a-f]{32}\.txt$/);
    expect(o.indexNow.publicHost).toBe(false);
    const op = clients.get('OPERATOR')!;
    expect((await put(op, '/v1/admin/seo/robots', { custom: null })).status).toBe(403);
  });

  it('page list carries templates, effective meta and product rich data', async () => {
    const { items } = (await owner().get('/v1/admin/seo/pages')).body as AdminSeoPagesDto;
    const p = items.find((i) => i.path === '/p/chalk-white' && i.locale === 'ru')!;
    expect(p.kind).toBe('product');
    expect(p.template.title).toMatch(/— цена, купить \| Forest$/);
    expect(p.effective.canonical).toMatch(/\/ru\/p\/chalk-white$/);
    expect(p.rich?.priceFromSoum).toBeGreaterThan(0);
    expect(items.some((i) => i.path === '/' && i.kind === 'home')).toBe(true);
    expect(items.some((i) => i.kind === 'category')).toBe(true);
  });

  it('meta CRUD: audited, public endpoint, storefront revalidated; blank = template', async () => {
    stub.calls.length = 0;
    const res = await put(owner(), '/v1/admin/seo/meta', {
      path: '/p/chalk-white',
      locale: 'uz',
      title: 'Chalk White — sinov sarlavhasi',
      description: '',
      noindex: false,
      canonical: null,
      ogImageId: null,
    });
    expect(res.status).toBe(200);
    const page = res.body as AdminSeoPageDto;
    expect(page.effective.title).toBe('Chalk White — sinov sarlavhasi');
    expect(page.effective.description).toBe(page.template.description);
    expect((await lastAudit('seo.meta_update'))?.entityId).toBe('uz:/p/chalk-white');

    const pub = await http()
      .get('/v1/seo/meta')
      .query({ path: '/p/chalk-white', locale: 'uz' })
      .expect(200);
    expect(pub.body.meta).toMatchObject({
      title: 'Chalk White — sinov sarlavhasi',
      description: null,
      noindex: false,
    });

    await web.settle();
    expect(stub.calls).toContainEqual({
      tags: ['seo:/p/chalk-white', 'product:chalk-white'],
      verified: true,
    });

    const reset = await put(owner(), '/v1/admin/seo/meta', {
      path: '/p/chalk-white',
      locale: 'uz',
      title: '',
      description: '',
    });
    expect(reset.status).toBe(200);
    expect(reset.body.override).toBeNull();
    expect(await lastAudit('seo.meta_reset')).not.toBeNull();
    expect(
      (await http().get('/v1/seo/meta').query({ path: '/p/chalk-white', locale: 'uz' })).body,
    ).toEqual({ meta: null });

    const unknown = await put(owner(), '/v1/admin/seo/meta', {
      path: '/p/nope',
      locale: 'uz',
      title: 'x',
      description: '',
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('SEO_PAGE_UNKNOWN');
    const badCanonical = await put(owner(), '/v1/admin/seo/meta', {
      path: '/',
      locale: 'uz',
      title: '',
      description: '',
      canonical: 'javascript:alert(1)',
    });
    expect(badCanonical.body.error.code).toBe('SEO_CANONICAL_INVALID');
  });

  it('a product save revalidates the product page and listings', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: 'chalk-white' } });
    stub.calls.length = 0;
    const res = await owner().send('patch', `/v1/admin/products/${product.id}`, {
      seo: { uz: { title: '', description: '' }, ru: { title: '', description: '' } },
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    await web.settle();
    expect(stub.calls).toContainEqual({
      tags: ['product:chalk-white', 'catalog', 'content'],
      verified: true,
    });
  });

  it('redirects: chains collapsed, loops and live sources refused, 404 row cleared, audited', async () => {
    const a = await owner().post('/v1/admin/seo/redirects', {
      from: '/uz/t-seo-a',
      to: '/uz/p/chalk-white',
    });
    expect(a.status).toBe(201);
    const b = await owner().post('/v1/admin/seo/redirects', {
      from: '/uz/t-seo-b/?x=1',
      to: '/uz/t-seo-a',
    });
    expect((b.body as AdminRedirectDto).to).toBe('/uz/p/chalk-white');
    expect((b.body as AdminRedirectDto).from).toBe('/uz/t-seo-b/');
    // a → b would close a loop (b already ends at a's target… and a itself).
    const loop = await owner().post('/v1/admin/seo/redirects', {
      from: '/uz/p/chalk-white',
      to: '/uz/t-seo-a',
    });
    expect(loop.body.error.code).toBe('REDIRECT_SOURCE_LIVE');
    const c = await owner().post('/v1/admin/seo/redirects', {
      from: '/uz/t-seo-c',
      to: '/uz/t-seo-d',
    });
    expect(c.status).toBe(201);
    const cycle = await owner().post('/v1/admin/seo/redirects', {
      from: '/uz/t-seo-d',
      to: '/uz/t-seo-c',
    });
    expect(cycle.body.error.code).toBe('REDIRECT_LOOP');
    // Retargeting a: redirects pointing at a follow it (no chain via a).
    const moved = await owner().send('patch', `/v1/admin/seo/redirects/${a.body.id}`, {
      from: '/uz/t-seo-a',
      to: '/uz/katalog',
      code: 301,
    });
    expect(moved.status).toBe(200);
    expect(await prisma.redirect.findUnique({ where: { from: '/uz/t-seo-b/' } })).toMatchObject({
      to: '/uz/p/chalk-white',
    });
    expect((await lastAudit('seo.redirect_update'))?.entityId).toBe(a.body.id);

    // Storefront lookup counts hits.
    await http()
      .get('/v1/seo/redirect')
      .query({ path: '/uz/t-seo-a' })
      .expect(200, { to: '/uz/katalog', code: 301 });
    const list = (await owner().get('/v1/admin/seo/redirects?q=t-seo-a')).body;
    expect(list.items[0]).toMatchObject({ from: '/uz/t-seo-a', hits: 1 });
    expect(list.items[0].lastHitAt).not.toBeNull();

    // 404 log → suggestion → create redirect clears the row.
    await http()
      .post('/v1/seo/not-found')
      .send({ path: '/uz/p/chalk-whit', referrer: 'http://localhost:3000/uz/katalog?x=1' })
      .expect(204);
    const nf = (await owner().get('/v1/admin/seo/not-found?days=7')).body as AdminNotFoundDto[];
    expect(nf.find((n) => n.path === '/uz/p/chalk-whit')).toMatchObject({
      internal: true,
      suggestion: '/uz/p/chalk-white',
      referrer: 'http://localhost:3000/uz/katalog',
    });
    const overview = (await owner().get('/v1/admin/seo/overview')).body as AdminSeoOverviewDto;
    expect(overview.health.issues.find((i) => i.rule === 'broken_link')?.examples).toContainEqual(
      expect.objectContaining({ path: '/uz/p/chalk-whit' }),
    );
    await owner().post('/v1/admin/seo/redirects', {
      from: '/uz/p/chalk-whit',
      to: '/uz/p/chalk-white',
    });
    expect(await prisma.notFoundLog.findUnique({ where: { path: '/uz/p/chalk-whit' } })).toBeNull();
    await prisma.redirect.deleteMany({ where: { from: '/uz/p/chalk-whit' } });

    const del = await owner().send('delete', `/v1/admin/seo/redirects/${c.body.id}`);
    expect(del.status).toBe(200);
    expect((await lastAudit('seo.redirect_delete'))?.entityId).toBe(c.body.id);
  });

  it('sitemap: index + per locale/type files; noindex pages leave it after regenerate', async () => {
    const index = await http().get('/v1/seo/sitemap.xml').expect(200);
    expect(index.headers['content-type']).toMatch(/application\/xml/);
    expect(index.text).toContain('/sitemaps/uz-products.xml</loc>');
    expect(index.text).toContain('/sitemaps/ru-pages.xml</loc>');
    const products = await http().get('/v1/seo/sitemaps/ru-products.xml').expect(200);
    expect(products.text).toContain('/ru/p/chalk-white</loc>');
    expect(products.text).toContain('hreflang="x-default"');
    const pages = await http().get('/v1/seo/sitemaps/uz-pages.xml').expect(200);
    expect(pages.text).toContain('/uz/oferta</loc>');
    expect(pages.text).not.toContain('/savat');
    await http().get('/v1/seo/sitemaps/en-products.xml').expect(404);

    await put(owner(), '/v1/admin/seo/meta', {
      path: '/p/chalk-white',
      locale: 'ru',
      title: '',
      description: '',
      noindex: true,
    });
    const regen = await owner().post('/v1/admin/seo/sitemap/regenerate');
    expect(regen.status).toBe(201);
    expect((await lastAudit('seo.sitemap_regenerate'))?.after).toMatchObject({
      urls: regen.body.urls,
    });
    const after = await http().get('/v1/seo/sitemaps/ru-products.xml').expect(200);
    expect(after.text).not.toContain('/ru/p/chalk-white</loc>');
    expect((await http().get('/v1/seo/sitemaps/uz-products.xml')).text).toContain(
      '/uz/p/chalk-white</loc>',
    );
    await put(owner(), '/v1/admin/seo/meta', {
      path: '/p/chalk-white',
      locale: 'ru',
      title: '',
      description: '',
    });
    await owner().post('/v1/admin/seo/sitemap/regenerate');
  });

  it('robots.txt is editable and resets to the generated default', async () => {
    const custom = 'User-agent: *\nDisallow: /tmp-seo-test\n';
    expect((await put(owner(), '/v1/admin/seo/robots', { custom })).status).toBe(200);
    const res = await http().get('/v1/seo/robots.txt').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toBe(custom);
    await put(owner(), '/v1/admin/seo/robots', { custom: '  ' });
    const def = await http().get('/v1/seo/robots.txt');
    expect(def.text).toContain('Disallow: /uz/checkout');
    expect(def.text).toMatch(/Sitemap: .*\/sitemap\.xml/);
    expect((await lastAudit('settings.seo.robots.update'))?.staffId).not.toBeNull();
  });

  it('verification codes: meta tags parsed, public settings updated, junk refused', async () => {
    stub.calls.length = 0;
    const res = await put(owner(), '/v1/admin/seo/verification', {
      google: '<meta name="google-site-verification" content="Abc_123-xyz.TEST" />',
      yandex: '0123456789abcdef',
      bing: '',
    });
    expect(res.body).toEqual({
      google: 'Abc_123-xyz.TEST',
      yandex: '0123456789abcdef',
      bing: null,
    });
    const pub = (await http().get('/v1/settings/public')).body as PublicSettingsDto;
    expect(pub.seo).toEqual({ google: 'Abc_123-xyz.TEST', yandex: '0123456789abcdef', bing: null });
    await web.settle();
    expect(stub.calls).toContainEqual({ tags: ['settings', 'seo'], verified: true });
    const bad = await put(owner(), '/v1/admin/seo/verification', {
      google: '"><script>',
      yandex: null,
      bing: null,
    });
    expect(bad.body.error.code).toBe('SEO_VERIFICATION_INVALID');
  });

  it('schema toggles reach the storefront config; IndexNow key file served for the current key only', async () => {
    const off = {
      product: true,
      organization: false,
      breadcrumb: true,
      faq: true,
      howTo: false,
      video: false,
    };
    expect((await put(owner(), '/v1/admin/seo/schema', off)).status).toBe(200);
    expect((await http().get('/v1/seo/public')).body).toEqual({ schema: off });

    const { key } = (await prisma.setting.findUniqueOrThrow({ where: { key: 'seo.indexnow' } }))
      .value as {
      key: string;
    };
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    const file = await http().get(`/v1/seo/indexnow/${key}`).expect(200);
    expect(file.text).toBe(key);
    await http().get('/v1/seo/indexnow/0123456789abcdef0123456789abcdef').expect(404);
    expect((await put(owner(), '/v1/admin/seo/indexnow', { enabled: false })).body).toEqual({
      enabled: false,
    });
  });

  it('search queries report: totals vs previous period and top queries', async () => {
    const svc = app.get(SearchQueriesService);
    const now = new Date('2026-10-27T08:00:00Z');
    await svc.ingest('gsc', '2026-10-20', '2026-10-26', [
      {
        date: '2026-10-25',
        query: 't-seo mebel kraska',
        clicks: 10,
        impressions: 100,
        position: 4,
      },
      { date: '2026-10-26', query: 't-seo mebel kraska', clicks: 5, impressions: 100, position: 6 },
      { date: '2026-10-26', query: 't-seo divan', clicks: 1, impressions: 50, position: null },
      { date: '2026-11-30', query: 't-seo outside', clicks: 9, impressions: 9, position: 1 },
    ]);
    const r: AdminSearchQueriesDto = await svc.report('gsc', 7, now);
    expect(r.totals).toEqual({ clicks: 16, impressions: 250, ctr: 16 / 250, position: 5 });
    expect(r.previous).toBeNull();
    expect(r.items[0]).toEqual({
      query: 't-seo mebel kraska',
      clicks: 15,
      impressions: 200,
      ctr: 0.075,
      position: 5,
    });
    expect(r.items.some((i) => i.query === 't-seo outside')).toBe(false);
    // Fake mode: the sync makes no external call and keeps the stored rows.
    const sync = await owner().post('/v1/admin/seo/queries/sync');
    expect(sync.status).toBe(201);
    expect(
      await prisma.searchQueryDaily.count({ where: { query: { startsWith: 't-seo ' } } }),
    ).toBe(3);
  });

  it('CWV and zero-result searches answer with empty-safe shapes', async () => {
    const cwv = (await owner().get('/v1/admin/seo/cwv')).body;
    expect(cwv.metrics.map((m: { metric: string }) => m.metric)).toEqual(['LCP', 'INP', 'CLS']);
    // Fake mode: PageSpeed makes no external call.
    const lab = await owner().post('/v1/admin/seo/cwv/pagespeed', { path: '/uz' });
    expect(lab.status).toBe(201);
    expect((await owner().get('/v1/admin/seo/zero-results')).status).toBe(200);
  });
});
