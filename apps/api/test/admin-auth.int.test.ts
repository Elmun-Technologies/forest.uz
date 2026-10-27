import type { AdminMeDto, StaffInviteResultDto, TotpSetupDto } from '@forest/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ADMIN_AUTH_POLICY } from '../src/admin/auth/admin-auth.service';
import { base32Decode, hotp, totpStep } from '../src/admin/auth/totp';
import { StaffService } from '../src/admin/staff/staff.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  AdminClient,
  createAdminTestApp,
  createStaff,
  nextTotpCode,
  signedIn,
  STRONG_PASSWORD,
} from './admin-helpers';

describe('admin auth (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createAdminTestApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  const cookieHeader = (res: request.Response, name: string) =>
    ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find((c) =>
      c.startsWith(`${name}=`),
    );

  // ───────── CSRF ─────────

  describe('CSRF', () => {
    it('issues a readable double-submit token', async () => {
      const client = new AdminClient(app);
      const res = await client.get('/v1/admin/auth/csrf');
      expect(res.status).toBe(200);
      const cookie = cookieHeader(res, 'fr_admin_csrf')!;
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).not.toContain('HttpOnly');
      expect(res.body.token).toBe(client.csrf);
    });

    it('refuses state-changing requests without the token, or from a foreign origin', async () => {
      const staff = await createStaff(prisma, 'OPERATOR');
      const client = new AdminClient(app);
      const missing = await client.post(
        '/v1/admin/auth/login',
        { email: staff.email, password: staff.password },
        { csrf: null },
      );
      expect(missing.status).toBe(403);
      expect(missing.body.error.code).toBe('ADMIN_CSRF_INVALID');

      await client.get('/v1/admin/auth/csrf');
      const foreign = await client.agent
        .post('/v1/admin/auth/login')
        .set('X-Forwarded-For', client.ip)
        .set('Origin', 'https://evil.example')
        .set('X-CSRF-Token', client.csrf!)
        .send({ email: staff.email, password: staff.password });
      expect(foreign.status).toBe(403);
      expect(foreign.body.error.details).toEqual({ reason: 'bad_origin' });
    });

    it('with a session, only the session-bound token is accepted; GETs are exempt', async () => {
      const { client } = await signedIn(app, 'OPERATOR');
      expect((await client.get('/v1/admin/auth/me')).status).toBe(200);
      const noHeader = await client.post('/v1/admin/auth/logout', undefined, { csrf: null });
      expect(noHeader.status).toBe(403);
      // An attacker able to plant a cookie still can't match the token bound to the session.
      const planted = 'p'.repeat(43);
      const forged = await client.agent
        .post('/v1/admin/auth/logout')
        .set('X-Forwarded-For', client.ip)
        .set('Cookie', `fr_admin=${client.session}; fr_admin_csrf=${planted}`)
        .set('X-CSRF-Token', planted);
      expect(forged.status).toBe(403);
      expect((await client.post('/v1/admin/auth/logout')).status).toBe(204);
      expect((await client.get('/v1/admin/auth/me')).status).toBe(401);
    });
  });

  // ───────── password step ─────────

  describe('login', () => {
    it('same generic error for unknown email and wrong password', async () => {
      const staff = await createStaff(prisma, 'OPERATOR');
      const client = new AdminClient(app);
      const unknown = await client.login('nobody@staff.test', staff.password);
      const wrong = await client.login(staff.email, 'wrong-password-123');
      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(unknown.body).toEqual(wrong.body);
      expect(wrong.body.error.code).toBe('ADMIN_LOGIN_FAILED');
    });

    it('optional-TOTP role gets a full 12 h session with strict cookies', async () => {
      const staff = await createStaff(prisma, 'WAREHOUSE');
      const client = new AdminClient(app);
      const res = await client.login(staff.email, staff.password);
      expect(res.status).toBe(200);
      const me = res.body as AdminMeDto;
      expect(me.stage).toBe('full');
      expect(me.permissions).toContain('orders.view');
      expect(me.permissions).not.toContain('promo.edit');
      const session = cookieHeader(res, 'fr_admin')!;
      expect(session).toMatch(/HttpOnly/);
      expect(session).toMatch(/SameSite=Strict/);
      expect(session).toMatch(/Max-Age=43200/);
      expect(session).not.toMatch(/Domain=/i);
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
      expect(row.lastLoginAt).not.toBeNull();
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.login', staffId: staff.id },
      });
      expect(audit.ip).toBeTruthy();
    });

    it('rotates the session id on login', async () => {
      const staff = await createStaff(prisma, 'OPERATOR');
      const client = new AdminClient(app);
      await client.login(staff.email, staff.password);
      const first = client.session;
      await client.login(staff.email, staff.password);
      expect(client.session).not.toBe(first);
      const stale = await request(app.getHttpServer())
        .get('/v1/admin/auth/me')
        .set('Cookie', `fr_admin=${first}`);
      expect(stale.status).toBe(401);
    });

    it(`locks the account after ${ADMIN_AUTH_POLICY.maxFailures} failures`, async () => {
      const staff = await createStaff(prisma, 'OPERATOR');
      const client = new AdminClient(app);
      for (let i = 0; i < ADMIN_AUTH_POLICY.maxFailures; i++)
        expect((await client.login(staff.email, 'wrong-password-123')).status).toBe(401);
      const locked = await client.login(staff.email, staff.password);
      expect(locked.status).toBe(401);
      expect(locked.body.error.code).toBe('ADMIN_LOGIN_FAILED');
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
      expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
      expect(
        await prisma.auditLog.count({
          where: { action: 'staff.login_locked', entityId: staff.id },
        }),
      ).toBe(1);
      // Lock expired → the right password works and the counter is clean.
      await prisma.staff.update({
        where: { id: staff.id },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      const fresh = new AdminClient(app);
      expect((await fresh.login(staff.email, staff.password)).status).toBe(200);
      expect((await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } })).failedLogins).toBe(
        0,
      );
    });

    it(`rate-limits ${ADMIN_AUTH_POLICY.ipLimit} attempts per IP`, async () => {
      const client = new AdminClient(app);
      const statuses: number[] = [];
      for (let i = 0; i <= ADMIN_AUTH_POLICY.ipLimit; i++)
        statuses.push((await client.login(`probe${i}@staff.test`, 'whatever-123')).status);
      expect(statuses.slice(0, ADMIN_AUTH_POLICY.ipLimit).every((s) => s === 401)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
    });

    it('inactive staff cannot log in', async () => {
      const staff = await createStaff(prisma, 'OPERATOR');
      await prisma.staff.update({ where: { id: staff.id }, data: { active: false } });
      const res = await new AdminClient(app).login(staff.email, staff.password);
      expect(res.body.error.code).toBe('ADMIN_LOGIN_FAILED');
    });
  });

  // ───────── TOTP ─────────

  describe('TOTP', () => {
    it('Owner without TOTP is limited to enrolment, then gets full access', async () => {
      const owner = await createStaff(prisma, 'OWNER');
      const client = new AdminClient(app);
      const login = await client.login(owner.email, owner.password);
      expect(login.body).toMatchObject({ stage: 'setup', permissions: [] });
      expect(cookieHeader(login, 'fr_admin')).toMatch(/Max-Age=1800/);

      const blocked = await client.get('/v1/admin/staff');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('ADMIN_TOTP_SETUP_REQUIRED');
      expect((await client.get('/v1/admin/audit')).body.error.code).toBe(
        'ADMIN_TOTP_SETUP_REQUIRED',
      );
      expect((await client.get('/v1/admin/auth/me')).body.stage).toBe('setup');

      const early = await client.post('/v1/admin/auth/totp/verify', { code: '123456' });
      expect(early.body.error.code).toBe('ADMIN_TOTP_NOT_STARTED');

      const setup = await client.post('/v1/admin/auth/totp/setup');
      expect(setup.status).toBe(200);
      const { secret, otpauthUri } = setup.body as TotpSetupDto;
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(otpauthUri).toContain(`secret=${secret}`);
      expect(otpauthUri).toContain('issuer=Forest%20Admin');
      const stored = await prisma.staff.findUniqueOrThrow({ where: { id: owner.id } });
      expect(Buffer.from(stored.totpSecret!).toString('latin1')).not.toContain(secret);
      expect(stored.totpEnabled).toBe(false);

      const bad = await client.post('/v1/admin/auth/totp/verify', { code: '000000' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('ADMIN_TOTP_INVALID');

      const before = client.session;
      const ok = await client.post('/v1/admin/auth/totp/verify', {
        code: await nextTotpCode(prisma, owner.id, secret),
      });
      expect(ok.body).toMatchObject({ stage: 'full', totp: { enabled: true, required: true } });
      expect(client.session).not.toBe(before);
      expect(cookieHeader(ok, 'fr_admin')).toMatch(/Max-Age=43200/);
      expect((await client.get('/v1/admin/staff')).status).toBe(200);
      expect(
        await prisma.auditLog.count({
          where: { action: 'staff.totp_enabled', entityId: owner.id },
        }),
      ).toBe(1);

      const again = await client.post('/v1/admin/auth/totp/setup');
      expect(again.body.error.code).toBe('ADMIN_TOTP_ALREADY_ENABLED');
    });

    it('login with TOTP: step-up required, codes are single-use', async () => {
      const { client, email, password, id, secret } = await signedIn(app, 'MANAGER');
      await client.post('/v1/admin/auth/logout');
      const fresh = new AdminClient(app);
      const login = await fresh.login(email, password);
      expect(login.body).toMatchObject({ stage: 'totp', permissions: [] });
      expect(cookieHeader(login, 'fr_admin')).toMatch(/Max-Age=300/);

      const pending = await fresh.get('/v1/admin/audit');
      expect(pending.status).toBe(401);
      expect(pending.body.error.code).toBe('ADMIN_TOTP_REQUIRED');
      // Enrolment can't be restarted from a password-only session.
      expect((await fresh.post('/v1/admin/auth/totp/setup')).body.error.code).toBe(
        'ADMIN_TOTP_REQUIRED',
      );

      // Replay: the step used at enrolment is spent.
      const row = await prisma.staff.findUniqueOrThrow({ where: { id } });
      const used = hotp(base32Decode(secret!), row.totpLastUsedStep!);
      const replay = await fresh.post('/v1/admin/auth/totp/verify', { code: used });
      expect(replay.body.error.code).toBe('ADMIN_TOTP_INVALID');
      // ...and so is any older step.
      const older = hotp(base32Decode(secret!), row.totpLastUsedStep! - 1);
      expect((await fresh.post('/v1/admin/auth/totp/verify', { code: older })).status).toBe(400);

      const code = await nextTotpCode(prisma, id, secret!);
      const ok = await fresh.post('/v1/admin/auth/totp/verify', { code });
      expect(ok.body.stage).toBe('full');
      expect((await fresh.get('/v1/admin/audit')).status).toBe(200);

      // The same code again (another session) is refused.
      const other = new AdminClient(app);
      await other.login(email, password);
      expect((await other.post('/v1/admin/auth/totp/verify', { code })).status).toBe(400);
    });

    it('dev endpoint returns the next acceptable code (fake mode only)', async () => {
      const { email, password, id, secret } = await signedIn(app, 'OWNER');
      const dev = await request(app.getHttpServer())
        .post('/v1/dev/admin-totp')
        .send({ email })
        .expect(200);
      const row = await prisma.staff.findUniqueOrThrow({ where: { id } });
      expect(dev.body.step).toBeGreaterThan(row.totpLastUsedStep!);
      expect(dev.body.code).toBe(hotp(base32Decode(secret!), dev.body.step as number));
      const client = new AdminClient(app);
      await client.login(email, password);
      expect(
        (await client.post('/v1/admin/auth/totp/verify', { code: dev.body.code })).body.stage,
      ).toBe('full');
      await request(app.getHttpServer())
        .post('/v1/dev/admin-totp')
        .send({ email: 'nobody@staff.test' })
        .expect(404);
      expect(totpStep(Date.now())).toBeGreaterThan(0);
    });
  });

  // ───────── invites & staff management ─────────

  describe('invite → accept → login', () => {
    it('Owner invites; the link works once with a strong password', async () => {
      const { client: owner } = await signedIn(app, 'OWNER');
      const email = `invited-${Date.now()}@staff.test`;
      const res = await owner.post('/v1/admin/staff', {
        name: 'Madina Karimova',
        email,
        role: 'OPERATOR',
        phone: '90 123 45 67',
      });
      expect(res.status).toBe(201);
      const invite = res.body as StaffInviteResultDto;
      expect(invite.staff).toMatchObject({
        email,
        role: 'OPERATOR',
        invitePending: true,
        phone: '+998 90 *** ** 67',
      });
      const token = invite.inviteUrl.split('/invite/')[1]!;
      expect(token).toMatch(/^[\w-]{43}$/);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'staff.invite', entityId: invite.staff.id },
      });
      expect(JSON.stringify(audit)).not.toContain(token);

      const anon = new AdminClient(app);
      const info = await anon.get(`/v1/admin/auth/invite/${token}`);
      expect(info.body).toEqual({
        name: 'Madina Karimova',
        email,
        role: 'OPERATOR',
        totpRequired: false,
      });
      // Pending staff can't log in with any password.
      expect((await anon.login(email, STRONG_PASSWORD)).status).toBe(401);

      const weak = await anon.post('/v1/admin/auth/accept-invite', {
        token,
        password: 'madina123456789',
      });
      expect(weak.body.error).toMatchObject({ code: 'ADMIN_PASSWORD_WEAK', field: 'password' });

      const accepted = await anon.post('/v1/admin/auth/accept-invite', {
        token,
        password: STRONG_PASSWORD,
      });
      expect(accepted.status).toBe(200);
      expect(accepted.body.stage).toBe('full');
      expect((await anon.get('/v1/admin/auth/me')).body.staff.email).toBe(email);

      const reuse = await new AdminClient(app).post('/v1/admin/auth/accept-invite', {
        token,
        password: STRONG_PASSWORD,
      });
      expect(reuse.status).toBe(404);
      expect(reuse.body.error.code).toBe('ADMIN_INVITE_INVALID');
      expect((await new AdminClient(app).login(email, STRONG_PASSWORD)).body.stage).toBe('full');
    });

    it('invited Manager must enrol TOTP right after setting the password', async () => {
      const { client: owner } = await signedIn(app, 'OWNER');
      const res = await owner.post('/v1/admin/staff', {
        name: 'Menejer',
        email: `mgr-${Date.now()}@staff.test`,
        role: 'MANAGER',
      });
      const token = (res.body as StaffInviteResultDto).inviteUrl.split('/invite/')[1]!;
      const anon = new AdminClient(app);
      expect((await anon.get(`/v1/admin/auth/invite/${token}`)).body.totpRequired).toBe(true);
      const accepted = await anon.post('/v1/admin/auth/accept-invite', {
        token,
        password: STRONG_PASSWORD,
      });
      expect(accepted.body.stage).toBe('setup');
    });

    it('re-issuing an invite revokes the previous link', async () => {
      const { client: owner } = await signedIn(app, 'OWNER');
      const first = (
        await owner.post('/v1/admin/staff', {
          name: 'Ombor',
          email: `wh-${Date.now()}@staff.test`,
          role: 'WAREHOUSE',
        })
      ).body as StaffInviteResultDto;
      const second = await owner.post(`/v1/admin/staff/${first.staff.id}/invite`);
      expect(second.status).toBe(200);
      const anon = new AdminClient(app);
      const oldToken = first.inviteUrl.split('/invite/')[1]!;
      expect((await anon.get(`/v1/admin/auth/invite/${oldToken}`)).status).toBe(404);
      const newToken = (second.body as StaffInviteResultDto).inviteUrl.split('/invite/')[1]!;
      expect((await anon.get(`/v1/admin/auth/invite/${newToken}`)).status).toBe(200);
    });

    it('duplicate email → ADMIN_STAFF_EXISTS', async () => {
      const { client: owner } = await signedIn(app, 'OWNER');
      const existing = await createStaff(prisma, 'OPERATOR');
      const res = await owner.post('/v1/admin/staff', {
        name: 'Dup',
        email: existing.email.toUpperCase(),
        role: 'OPERATOR',
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ADMIN_STAFF_EXISTS');
    });
  });

  describe('staff changes', () => {
    it('deactivation ends sessions; role changes apply on the next request', async () => {
      const { client: owner } = await signedIn(app, 'OWNER');
      const target = await signedIn(app, 'OPERATOR');
      expect((await target.client.get('/v1/admin/auth/me')).body.permissions).not.toContain(
        'promo.edit',
      );

      const promoted = await owner.send('patch', `/v1/admin/staff/${target.id}`, {
        role: 'MARKETER',
      });
      expect(promoted.body.role).toBe('MARKETER');
      expect((await target.client.get('/v1/admin/auth/me')).body.permissions).toContain(
        'promo.edit',
      );
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'staff.update', entityId: target.id },
      });
      expect(audit).toMatchObject({ before: { role: 'OPERATOR' }, after: { role: 'MARKETER' } });

      await owner.send('patch', `/v1/admin/staff/${target.id}`, { active: false });
      expect((await target.client.get('/v1/admin/auth/me')).status).toBe(401);
      expect((await new AdminClient(app).login(target.email, target.password)).status).toBe(401);
    });

    it('a role change to Manager forces TOTP enrolment', async () => {
      const { client: owner } = await signedIn(app, 'OWNER');
      const target = await signedIn(app, 'OPERATOR');
      await owner.send('patch', `/v1/admin/staff/${target.id}`, { role: 'MANAGER' });
      const res = await target.client.get('/v1/admin/audit');
      expect(res.body.error.code).toBe('ADMIN_TOTP_SETUP_REQUIRED');
    });

    it('nobody changes their own role or active flag', async () => {
      const owner = await signedIn(app, 'OWNER');
      const self = await owner.client.send('patch', `/v1/admin/staff/${owner.id}`, {
        role: 'OPERATOR',
      });
      expect(self.body.error.code).toBe('ADMIN_SELF_CHANGE');
      const reset = await owner.client.post(`/v1/admin/staff/${owner.id}/reset-totp`);
      expect(reset.body.error.code).toBe('ADMIN_SELF_CHANGE');
    });

    it('the last active Owner can be neither demoted nor deactivated', async () => {
      // Over HTTP the acting Owner always remains; the invariant guards any other caller.
      const sole = await signedIn(app, 'OWNER');
      const others = await prisma.staff.findMany({
        where: { role: 'OWNER', active: true, id: { not: sole.id } },
        select: { id: true },
      });
      await prisma.staff.updateMany({
        where: { id: { in: others.map((o) => o.id) } },
        data: { active: false },
      });
      const system = { staffId: null, ip: null, userAgent: null };
      const staff = app.get(StaffService);
      try {
        await expect(staff.update(system, sole.id, { active: false })).rejects.toMatchObject({
          code: 'ADMIN_LAST_OWNER',
        });
        await expect(staff.update(system, sole.id, { role: 'MANAGER' })).rejects.toMatchObject({
          code: 'ADMIN_LAST_OWNER',
        });
        // A pending (not yet accepted) Owner invite doesn't count as a remaining Owner.
        await prisma.staff.create({
          data: { email: `pending-owner-${Date.now()}@staff.test`, name: 'P', role: 'OWNER' },
        });
        await expect(staff.update(system, sole.id, { active: false })).rejects.toMatchObject({
          code: 'ADMIN_LAST_OWNER',
        });
      } finally {
        await prisma.staff.updateMany({
          where: { id: { in: others.map((o) => o.id) } },
          data: { active: true },
        });
      }
      // With another active Owner the change is allowed.
      const res = await staff.update(system, sole.id, { role: 'MANAGER' });
      expect(res.role).toBe('MANAGER');
    });

    it('reset TOTP ends sessions and requires enrolment again', async () => {
      const { client: owner } = await signedIn(app, 'OWNER');
      const target = await signedIn(app, 'MANAGER');
      const res = await owner.post(`/v1/admin/staff/${target.id}/reset-totp`);
      expect(res.body.totpEnabled).toBe(false);
      expect((await target.client.get('/v1/admin/auth/me')).status).toBe(401);
      const again = await new AdminClient(app).login(target.email, target.password);
      expect(again.body.stage).toBe('setup');
      expect(
        (await prisma.staff.findUniqueOrThrow({ where: { id: target.id } })).totpSecret,
      ).toBeNull();
    });
  });
});

describe('dev admin TOTP endpoint without DEV_ENDPOINTS', () => {
  it('is a 404', async () => {
    const app = await createAdminTestApp([], { DEV_ENDPOINTS: 'false' });
    try {
      await request(app.getHttpServer())
        .post('/v1/dev/admin-totp')
        .send({ email: 'owner@staff.test' })
        .expect(404);
    } finally {
      await app.close();
    }
  });
});
