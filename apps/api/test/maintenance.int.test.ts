import type { NestExpressApplication } from '@nestjs/platform-express';
import { MaintenanceService } from '../src/jobs/maintenance.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './app';

describe('Event partition maintenance (integration)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('creates monthly partitions ahead, in UTC, and reports DEFAULT rows', async () => {
    const prisma = app.get(PrismaService);
    const svc = app.get(MaintenanceService);
    expect(await svc.ensureEventPartitions(6)).toEqual({ defaultRows: 0 });
    const parts = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'event_parts' ORDER BY tablename`;
    expect(parts.length).toBeGreaterThanOrEqual(8);
    // Bounds are UTC midnights regardless of session TimeZone.
    await prisma.$executeRawUnsafe(`SET TIME ZONE 'Asia/Tashkent'`);
    const now = new Date();
    const firstOfMonthUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    await prisma.$executeRaw`INSERT INTO "Event"(id, ts, "sessionId", "anonymousId", name, path)
      VALUES ('t-boundary', ${firstOfMonthUtc}, 's', 'a', 'page_view', '/')`;
    const [row] = await prisma.$queryRaw<{ part: string }[]>`
      SELECT tableoid::regclass::text AS part FROM "Event" WHERE id = 't-boundary'`;
    const expected = `event_parts.event_${firstOfMonthUtc.getUTCFullYear()}_${String(firstOfMonthUtc.getUTCMonth() + 1).padStart(2, '0')}`;
    expect(row?.part).toBe(expected);
    await prisma.$executeRaw`DELETE FROM "Event" WHERE id = 't-boundary'`;
  });

  it('enforces DB invariants', async () => {
    const prisma = app.get(PrismaService);
    await expect(
      prisma.variant.update({ where: { sku: 'FR-BR-40' }, data: { stock: -1 } }),
    ).rejects.toThrow();
    await expect(
      prisma.variant.update({ where: { sku: 'FR-BR-40' }, data: { ikpu: null } }),
    ).rejects.toThrow(/IKPU/);
  });
});
