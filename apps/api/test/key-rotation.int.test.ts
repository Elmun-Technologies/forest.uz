import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { totpAad } from '../src/admin/auth/admin-auth.service';
import { base32Decode, generateTotpSecret, hotp } from '../src/admin/auth/totp';
import { loadEnv } from '../src/config/env';
import { rotateSealedSecrets } from '../src/integrations/crypto/rotate-keys';
import { keyringFromEnv, SecretBox } from '../src/integrations/crypto/secret-box';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { WebhookSecrets } from '../src/webhooks-out/webhook-secrets';
import { createTestApp, nextTestIp } from './app';

/**
 * F-02: APP_ENCRYPTION_KEY rotation. The app runs with a new key and the old one in
 * APP_ENCRYPTION_KEY_PREVIOUS: every SecretBox user still decrypts old rows, and
 * `rotateSealedSecrets` re-seals them with the new key (idempotent, unknown keys left alone).
 * Test keys are generated at run time.
 */
describe('master key rotation (integration)', () => {
  const run = Date.now().toString(36);
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const foreignKey = randomBytes(32);
  const oldBox = new SecretBox({ current: oldKey });
  const newOnly = new SecretBox({ current: newKey });
  const integrationKey = `rotate-test-${run}`;
  const foreignIntegrationKey = `rotate-test-${run}-foreign`;
  const creds = { token: `tok-${run}`, webhookToken: `wh-${run}` };
  const webhookSecret = `whsec_${randomBytes(16).toString('hex')}`;
  const totpSecret = generateTotpSecret();

  let app: NestExpressApplication;
  let prisma: PrismaService;
  let staff: { id: string; email: string };
  let endpointId: string;
  let foreignBlob: Uint8Array<ArrayBuffer>;

  beforeAll(async () => {
    app = await createTestApp({
      APP_ENCRYPTION_KEY: newKey.toString('base64'),
      APP_ENCRYPTION_KEY_PREVIOUS: oldKey.toString('base64'),
    });
    prisma = app.get(PrismaService);
    // Rows sealed before the key change (old key, same AADs as the services).
    await prisma.integration.create({
      data: {
        key: integrationKey,
        credentials: new Uint8Array(oldBox.encryptJson(creds, integrationKey)),
      },
    });
    foreignBlob = new Uint8Array(
      new SecretBox({ current: foreignKey }).encryptJson(creds, foreignIntegrationKey),
    );
    await prisma.integration.create({
      data: { key: foreignIntegrationKey, credentials: foreignBlob },
    });
    const s = await prisma.staff.create({
      data: { email: `rotate-${run}@test.local`, name: 'Rotation', role: 'OPERATOR' },
    });
    staff = { id: s.id, email: s.email };
    await prisma.staff.update({
      where: { id: s.id },
      data: {
        totpSecret: new Uint8Array(oldBox.encrypt(totpSecret, totpAad(s.id))),
        totpEnabled: true,
      },
    });
    const ep = await prisma.webhookEndpoint.create({
      data: {
        url: 'https://partner.test/hook',
        events: ['order.created'],
        secret: new Uint8Array(0),
        active: false,
      },
    });
    endpointId = ep.id;
    await prisma.webhookEndpoint.update({
      where: { id: ep.id },
      data: { secret: new Uint8Array(oldBox.encrypt(webhookSecret, `webhook:${ep.id}`)) },
    });
  });

  afterAll(async () => {
    await prisma.webhookEndpoint.deleteMany({ where: { id: endpointId } });
    await prisma.staff.deleteMany({ where: { id: staff.id } });
    await prisma.integration.deleteMany({
      where: { key: { in: [integrationKey, foreignIntegrationKey] } },
    });
    await app.close();
    // createTestApp writes process.env; later files in this fork must not inherit the old key.
    delete process.env.APP_ENCRYPTION_KEY_PREVIOUS;
  });

  async function devTotp(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/dev/admin-totp')
      .set('X-Forwarded-For', nextTestIp())
      .send({ email: staff.email })
      .expect(200);
    const body = res.body as { code: string; step: number };
    expect(body.code).toBe(hotp(base32Decode(totpSecret), body.step));
    return body.code;
  }

  it('decrypts values sealed with a previous key in every SecretBox user', async () => {
    expect(await app.get(IntegrationsService).credentials(integrationKey)).toEqual(creds);
    await devTotp();
    const ep = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } });
    expect(app.get(WebhookSecrets).open(endpointId, ep.secret)).toBe(webhookSecret);
    // A key nobody configured stays undecryptable (logged, empty credentials).
    expect(await app.get(IntegrationsService).credentials(foreignIntegrationKey)).toEqual({});
  });

  it('re-seals old rows with the current key, leaves unknown ones alone, and is idempotent', async () => {
    const box = new SecretBox(keyringFromEnv(loadEnv(process.env)));
    const first = await rotateSealedSecrets(prisma, box);
    expect(first.integrationCredentials.rotated).toBeGreaterThanOrEqual(1);
    expect(first.integrationCredentials.failed).toBeGreaterThanOrEqual(1); // the foreign row
    expect(first.staffTotpSecrets.rotated).toBeGreaterThanOrEqual(1);
    expect(first.webhookSecrets.rotated).toBeGreaterThanOrEqual(1);

    // Our rows now open with the new key alone; plaintexts unchanged.
    const integ = await prisma.integration.findUniqueOrThrow({ where: { key: integrationKey } });
    expect(newOnly.needsRotation(integ.credentials!)).toBe(false);
    expect(newOnly.decryptJson(integ.credentials!, integrationKey)).toEqual(creds);
    const st = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(newOnly.decrypt(st.totpSecret!, totpAad(staff.id)).toString()).toBe(totpSecret);
    const ep = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } });
    expect(newOnly.decrypt(ep.secret, `webhook:${endpointId}`).toString()).toBe(webhookSecret);
    // The undecryptable row is untouched.
    const foreign = await prisma.integration.findUniqueOrThrow({
      where: { key: foreignIntegrationKey },
    });
    expect(Buffer.from(foreign.credentials!).equals(Buffer.from(foreignBlob))).toBe(true);

    // The running services keep working on the re-sealed rows.
    expect(await app.get(IntegrationsService).credentials(integrationKey)).toEqual(creds);
    expect(app.get(WebhookSecrets).open(endpointId, ep.secret)).toBe(webhookSecret);
    await devTotp();

    // Second run: nothing left to rotate.
    const second = await rotateSealedSecrets(prisma, box);
    expect(second.integrationCredentials.rotated).toBe(0);
    expect(second.staffTotpSecrets.rotated).toBe(0);
    expect(second.webhookSecrets.rotated).toBe(0);
  });
});
