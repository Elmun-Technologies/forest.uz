import {
  type AuditPageDto,
  PERMISSION_ROLES,
  type Permission,
  STAFF_ROLES,
  type StaffRole,
} from '@forest/contracts';
import { Get, Module, Post } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ADMIN_ACCESS_KEY, PERMISSIONS_KEY } from '../src/admin/admin-access';
import { Actor, AdminController, RequirePermissions } from '../src/admin/admin-http';
import { type AuditActor, AuditService } from '../src/admin/audit/audit.service';
import { AdminAuthController } from '../src/admin/auth/admin-auth.controller';
import { AdminAuthGuard, PermissionsGuard } from '../src/admin/auth/admin.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { AdminClient, createAdminTestApp, signedIn } from './admin-helpers';

/** Representative permissions, one probe route each (the docs/02 rows + a few silent ones). */
const PROBED: Permission[] = [
  'orders.view',
  'orders.cancel_refund',
  'customers.pii',
  'customers.export',
  'products.edit',
  'promo.edit',
  'analytics.view',
  'integrations.keys',
  'settings.staff',
  'audit.view',
];

/** Test-only admin routes: one per probed permission, plus deliberately broken ones. */
@AdminController('__probe')
class ProbeController {
  constructor(private readonly audit: AuditService) {}

  @Get('orders.view') @RequirePermissions('orders.view') a() {
    return { ok: true };
  }
  @Get('orders.cancel_refund') @RequirePermissions('orders.cancel_refund') b() {
    return { ok: true };
  }
  @Get('customers.pii') @RequirePermissions('customers.pii') c() {
    return { ok: true };
  }
  @Get('customers.export') @RequirePermissions('customers.export') d() {
    return { ok: true };
  }
  @Get('products.edit') @RequirePermissions('products.edit') e() {
    return { ok: true };
  }
  @Get('promo.edit') @RequirePermissions('promo.edit') f() {
    return { ok: true };
  }
  @Get('analytics.view') @RequirePermissions('analytics.view') g() {
    return { ok: true };
  }
  @Get('integrations.keys') @RequirePermissions('integrations.keys') h() {
    return { ok: true };
  }
  @Get('settings.staff') @RequirePermissions('settings.staff') i() {
    return { ok: true };
  }
  @Get('audit.view') @RequirePermissions('audit.view') j() {
    return { ok: true };
  }

  /** No decorator: the runtime guard must deny it. */
  @Get('undeclared') undeclared() {
    return { ok: true };
  }

  /** Mutation that forgets the audit row: the interceptor must fail it. */
  @Post('unaudited') @RequirePermissions('orders.edit') unaudited() {
    return { ok: true };
  }

  @Post('audited')
  @RequirePermissions('orders.edit')
  async audited(@Actor() actor: AuditActor) {
    await this.audit.record(actor, { action: 'probe.touch', entity: 'Probe', entityId: 'p1' });
    return { ok: true };
  }

  /** PII reveal helper: data comes back, the access is logged with field names only. */
  @Get('reveal')
  @RequirePermissions('customers.pii')
  reveal(@Actor() actor: AuditActor) {
    return this.audit.reveal(
      actor,
      { entity: 'Customer', entityId: 'cust-1', fields: ['phone', 'address'] },
      async () => ({ phone: '+998901234567', address: "Amir Temur ko'chasi 1" }),
    );
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('admin RBAC & audit (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const clients = new Map<StaffRole, AdminClient>();
  const ids = new Map<StaffRole, string>();

  beforeAll(async () => {
    app = await createAdminTestApp([ProbeModule]);
    prisma = app.get(PrismaService);
    for (const role of STAFF_ROLES) {
      const s = await signedIn(app, role);
      clients.set(role, s.client);
      ids.set(role, s.id);
    }
  });
  afterAll(async () => {
    await app.close();
  });

  describe('every role × probed permission (docs/02 matrix over HTTP)', () => {
    for (const role of STAFF_ROLES) {
      for (const permission of PROBED) {
        const allowed = PERMISSION_ROLES[permission].includes(role);
        it(`${role} ${permission} → ${allowed ? 200 : 403}`, async () => {
          const res = await clients.get(role)!.get(`/v1/admin/__probe/${permission}`);
          expect(res.status).toBe(allowed ? 200 : 403);
          if (!allowed) expect(res.body.error.code).toBe('FORBIDDEN');
        });
      }
    }
  });

  describe('real endpoints per role', () => {
    const table: [StaffRole, number, number][] = [
      // role, GET /admin/staff, GET /admin/audit
      ['OWNER', 200, 200],
      ['MANAGER', 403, 200],
      ['OPERATOR', 403, 403],
      ['WAREHOUSE', 403, 403],
      ['MARKETER', 403, 403],
    ];
    for (const [role, staff, audit] of table) {
      it(`${role}: staff ${staff}, audit ${audit}`, async () => {
        const client = clients.get(role)!;
        expect((await client.get('/v1/admin/staff')).status).toBe(staff);
        expect((await client.get('/v1/admin/audit')).status).toBe(audit);
      });
    }

    it('Manager cannot invite staff (Owner only)', async () => {
      const res = await clients.get('MANAGER')!.post('/v1/admin/staff', {
        name: 'X',
        email: `x-${Date.now()}@staff.test`,
        role: 'OWNER',
      });
      expect(res.status).toBe(403);
    });

    it('anonymous → 401', async () => {
      const res = await new AdminClient(app).get('/v1/admin/staff');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('default deny', () => {
    it('a route without @RequirePermissions is refused at runtime', async () => {
      const res = await clients.get('OWNER')!.get('/v1/admin/__probe/undeclared');
      expect(res.status).toBe(403);
    });

    it('every /admin route of the app declares its access (route metadata walk)', async () => {
      const plain = await createAdminTestApp();
      try {
        const offenders: string[] = [];
        let routes = 0;
        for (const mod of plain.get(ModulesContainer).values()) {
          for (const wrapper of mod.controllers.values()) {
            const ctrl = wrapper.metatype as (new (...a: never[]) => unknown) | null;
            if (!ctrl) continue;
            const base = String(Reflect.getMetadata(PATH_METADATA, ctrl) ?? '');
            if (!/^\/?admin(\/|$)/.test(base)) continue;
            const guards = (Reflect.getMetadata(GUARDS_METADATA, ctrl) ?? []) as unknown[];
            if (!guards.includes(AdminAuthGuard) || !guards.includes(PermissionsGuard))
              offenders.push(`${ctrl.name}: missing admin guards (use @AdminController)`);
            const proto = ctrl.prototype as Record<string, unknown>;
            for (const name of Object.getOwnPropertyNames(proto)) {
              const handler = proto[name];
              if (name === 'constructor' || typeof handler !== 'function') continue;
              if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
              routes++;
              const perms = Reflect.getMetadata(PERMISSIONS_KEY, handler) as unknown[] | undefined;
              const access = Reflect.getMetadata(ADMIN_ACCESS_KEY, handler) as unknown;
              if (access && ctrl !== AdminAuthController)
                offenders.push(`${ctrl.name}.${name}: public/session access outside auth`);
              if (!access && !perms?.length)
                offenders.push(`${ctrl.name}.${name}: no @RequirePermissions`);
            }
          }
        }
        expect(routes).toBeGreaterThanOrEqual(12);
        expect(offenders).toEqual([]);
      } finally {
        await plain.close();
      }
    });
  });

  describe('audit', () => {
    it('a mutation that writes no audit row fails loudly (tests)', async () => {
      const res = await clients.get('OPERATOR')!.post('/v1/admin/__probe/unaudited');
      expect(res.status).toBe(500);
      const ok = await clients.get('OPERATOR')!.post('/v1/admin/__probe/audited');
      expect(ok.status).toBe(201);
      const row = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'probe.touch', staffId: ids.get('OPERATOR') },
        orderBy: { createdAt: 'desc' },
      });
      expect(row.ip).toBeTruthy();
    });

    it('redacts secrets and PII in before/after', async () => {
      const actor: AuditActor = { staffId: ids.get('OWNER')!, ip: '10.0.0.1', userAgent: 'vitest' };
      await app.get(AuditService).record(actor, {
        action: 'probe.redaction',
        entity: 'Probe',
        entityId: 'r1',
        before: { password: 'hunter2-long', totpSecret: 'JBSWY3DPEHPK3PXP', note: 'ok' },
        after: {
          phone: '+998901234567',
          comment: 'call +998 90 123 45 67',
          nested: { apiKey: 'sk-live', token: 'abc', price: 10n },
        },
      });
      expect(actor.audited).toBe(true);
      const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'probe.redaction' } });
      const json = JSON.stringify(row);
      for (const secret of ['hunter2', 'JBSWY3DP', '901234567', 'sk-live', '"abc"'])
        expect(json).not.toContain(secret);
      expect(row.before).toMatchObject({ password: '[redacted]', note: 'ok' });
      expect(row.after).toMatchObject({
        comment: 'call +998 90 *** ** 67',
        nested: { price: '10' },
      });
      expect(row.userAgent).toBe('vitest');
    });

    it('PII reveal logs customer.view_pii with field names only', async () => {
      const res = await clients.get('OPERATOR')!.get('/v1/admin/__probe/reveal');
      expect(res.body.phone).toBe('+998901234567');
      const row = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'customer.view_pii', entityId: 'cust-1', staffId: ids.get('OPERATOR') },
      });
      expect(row.after).toEqual({ fields: ['phone', 'address'] });
      expect(JSON.stringify(row)).not.toContain('901234567');
      // Warehouse (partial PII only) can't reveal.
      expect((await clients.get('WAREHOUSE')!.get('/v1/admin/__probe/reveal')).status).toBe(403);
    });

    it('lists newest first with cursor pagination and filters', async () => {
      const owner = clients.get('OWNER')!;
      const ownerId = ids.get('OWNER')!;
      const first = await owner.get(`/v1/admin/audit?staffId=${ownerId}&limit=2`);
      const page1 = first.body as AuditPageDto;
      expect(page1.items).toHaveLength(2);
      expect(page1.items.every((i) => i.staff?.id === ownerId)).toBe(true);
      const ownLogin = page1.items.find((i) => i.entity === 'Staff' && i.entityId === ownerId);
      if (ownLogin) expect(ownLogin.entityLabel).toBe('OWNER tester');
      expect(page1.nextCursor).toBeTruthy();
      const page2 = (
        await owner.get(`/v1/admin/audit?staffId=${ownerId}&limit=2&cursor=${page1.nextCursor}`)
      ).body as AuditPageDto;
      const seen = new Set(page1.items.map((i) => i.id));
      expect(page2.items.some((i) => seen.has(i.id))).toBe(false);
      const times = [...page1.items, ...page2.items].map((i) => i.createdAt);
      expect([...times].sort().reverse()).toEqual(times);

      const byEntity = (await owner.get('/v1/admin/audit?entity=Probe&limit=100'))
        .body as AuditPageDto;
      expect(byEntity.items.length).toBeGreaterThan(0);
      expect(byEntity.items.every((i) => i.entity === 'Probe')).toBe(true);

      const future = (await owner.get('/v1/admin/audit?from=2099-01-01')).body as AuditPageDto;
      expect(future.items).toEqual([]);
      const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
      const todays = (await owner.get(`/v1/admin/audit?from=${today}&to=${today}&limit=5`))
        .body as AuditPageDto;
      expect(todays.items.length).toBeGreaterThan(0);

      const bad = await owner.get('/v1/admin/audit?cursor=not-a-cursor');
      expect(bad.status).toBe(400);

      const filters = await owner.get('/v1/admin/audit/filters');
      expect(filters.body.entities).toContain('Probe');
      expect(filters.body.actors.some((a: { id: string }) => a.id === ownerId)).toBe(true);
    });
  });
});
