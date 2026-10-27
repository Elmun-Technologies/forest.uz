import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { inject } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, shopper } from './app';

/** `pnpm --filter @forest/db seed -- --force` (dev reset) on the shared test DB. */
describe('seed --force (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  async function place(phone: string, paymentMethod: 'COD' | 'PAYME') {
    const variantId = (await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-RL-10' } })).id;
    const agent = shopper(app);
    await agent.post('/v1/cart/items').send({ variantId, qty: 1 }).expect(201);
    const res = await agent
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', `seed-${phone.slice(1)}-${Date.now()}`)
      .send({
        name: 'Nodira',
        phone,
        region: 'tashkent_city',
        addressLine: 'Olmazor 2-uy',
        zoneKey: 'tashkent-city-yandex',
        paymentMethod,
        offerVersion: 'v1',
      })
      .expect(201);
    return res.body.publicId as string;
  }

  it('L8: releasing holds also cancels the NEW orders that held them; later orders are kept', async () => {
    const cod = await place('+998935550201', 'COD');
    const online = await place('+998935550202', 'PAYME');
    const paid = await place('+998935550203', 'PAYME');
    await request(app.getHttpServer())
      .post('/v1/dev/fake-pay')
      .send({ order: paid, result: 'success' })
      .expect(201);

    execFileSync('pnpm', ['exec', 'tsx', 'src/seed/index.ts', '--force'], {
      cwd: path.resolve(__dirname, '../../../packages/db'),
      env: {
        ...process.env,
        DATABASE_URL: inject('databaseUrl'),
        S3_ENDPOINT: '',
        NODE_ENV: 'test',
      },
      stdio: 'pipe',
    });

    const load = (publicId: string) =>
      prisma.order.findUniqueOrThrow({
        where: { publicId },
        include: { payments: true, reservations: true, events: true },
      });
    for (const publicId of [cod, online]) {
      const o = await load(publicId);
      expect(o).toMatchObject({ status: 'CANCELLED', cancelReason: 'dev_seed_reset' });
      expect(o.payments.map((p) => p.status)).toEqual(['EXPIRED']);
      expect(o.reservations.every((r) => r.releasedAt !== null)).toBe(true);
      expect(o.events).toContainEqual(
        expect.objectContaining({ type: 'STATUS_CHANGED', from: 'NEW', to: 'CANCELLED' }),
      );
    }
    const kept = await load(paid);
    expect(kept.status).toBe('CONFIRMED');
    expect(kept.payments.map((p) => p.status)).toEqual(['PAID']);
    expect(await prisma.variant.count({ where: { reserved: { gt: 0 } } })).toBe(0);
    expect(await prisma.reservation.count({ where: { releasedAt: null } })).toBe(0);
  });
});
