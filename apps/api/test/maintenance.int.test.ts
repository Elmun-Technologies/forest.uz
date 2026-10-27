import type { NestExpressApplication } from '@nestjs/platform-express';
import { MaintenanceService, RETENTION } from '../src/jobs/maintenance.service';
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
    // Shared DB: fixed-clock suites may leave past-dated events in DEFAULT; the report must match.
    const [inDefault] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM event_parts.event_default`;
    expect(await svc.ensureEventPartitions(6)).toEqual({ defaultRows: Number(inDefault?.n ?? 0n) });
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

  it('drops event partitions and integration logs past their retention', async () => {
    const prisma = app.get(PrismaService);
    const svc = app.get(MaintenanceService);
    const now = new Date();
    const old = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - RETENTION.eventMonths - 2, 1),
    );
    const name = `event_${old.getUTCFullYear()}_${String(old.getUTCMonth() + 1).padStart(2, '0')}`;
    const next = new Date(Date.UTC(old.getUTCFullYear(), old.getUTCMonth() + 1, 1));
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS event_parts.${name} PARTITION OF "Event" FOR VALUES FROM ('${old.toISOString()}') TO ('${next.toISOString()}')`,
    );
    const integration = await prisma.integration.findFirstOrThrow({ select: { key: true } });
    const day = 86_400_000;
    const at = (days: number) => new Date(now.getTime() - days * day);
    const rows = await Promise.all(
      [
        { ok: true, createdAt: at(RETENTION.integrationLogDays + 1) },
        { ok: false, createdAt: at(RETENTION.integrationLogDays + 1) },
        { ok: false, createdAt: at(RETENTION.integrationLogFailedDays + 1) },
        { ok: true, createdAt: at(1) },
      ].map((r) =>
        prisma.integrationLog.create({
          data: {
            ...r,
            integrationKey: integration.key,
            direction: 'OUT',
            kind: 'retention-test',
            message: 'retention-test',
          },
        }),
      ),
    );
    const result = await svc.pruneRetention(now);
    expect(result.droppedPartitions).toBeGreaterThanOrEqual(1);
    const [gone] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'event_parts' AND tablename = ${name}`;
    expect(Number(gone?.n)).toBe(0);
    const left = await prisma.integrationLog.findMany({
      where: { kind: 'retention-test' },
      orderBy: { createdAt: 'asc' },
    });
    expect(left.map((r) => r.id)).toEqual([rows[1]!.id, rows[3]!.id]);
    await prisma.integrationLog.deleteMany({ where: { kind: 'retention-test' } });
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
