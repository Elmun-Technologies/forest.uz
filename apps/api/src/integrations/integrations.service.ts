import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@forest/contracts';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { redact } from '../common/redact';
import { PrismaService } from '../prisma/prisma.service';
import { maskSecret, parseKey, SecretBox } from './crypto/secret-box';
import {
  FakeAdSignalProvider,
  FakeAiProvider,
  FakeDeliveryProvider,
  FakeFiscalProvider,
  FakeInventoryProvider,
  FakeMessengerProvider,
  FakeOutbox,
  FakePaymentProvider,
  FakeSmsProvider,
} from './providers/fake';
import { ClickPaymentProvider } from './providers/click';
import { paymeAuthKey, PaymePaymentProvider } from './providers/payme';
import type {
  AdSignalProvider,
  AiProvider,
  DeliveryProvider,
  FiscalProvider,
  HealthResult,
  InventoryProvider,
  MessengerProvider,
  PaymentProvider,
  SmsProvider,
} from './providers/types';
import { getDefinition, INTEGRATIONS, type IntegrationDefinition } from './registry';

export interface IntegrationView {
  definition: IntegrationDefinition;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'COMING_SOON';
  /** Secret fields masked (last 4), text fields as-is; never full secrets. */
  fields: Record<string, string | null>;
  lastCheckAt: Date | null;
  lastError: string | null;
  usingFake: boolean;
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger('Integrations');
  private readonly box: SecretBox;
  readonly outbox = new FakeOutbox();
  private readonly fakes;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.box = new SecretBox({ current: parseKey(env.APP_ENCRYPTION_KEY) });
    this.fakes = {
      payme: new FakePaymentProvider('payme', env.APP_URL),
      click: new FakePaymentProvider('click', env.APP_URL),
      yandex: new FakeDeliveryProvider('yandex_delivery'),
      bts: new FakeDeliveryProvider('bts'),
      sms: new FakeSmsProvider(this.outbox, (m) => this.logger.log(m)),
      messenger: new FakeMessengerProvider(this.outbox),
      fiscal: new FakeFiscalProvider(),
      inventory: new FakeInventoryProvider(),
      ai: new FakeAiProvider(),
    };
  }

  /**
   * Fakes are used only in PROVIDERS_MODE=fake. In sandbox/live a provider must be connected and
   * implemented — otherwise we fail loudly (INTEGRATION_NOT_CONFIGURED) rather than silently faking
   * payments or SMS in a real store.
   */
  get fakeMode(): boolean {
    return this.env.PROVIDERS_MODE === 'fake';
  }

  private async real<T>(
    key: string,
    resolve: (credentials: Record<string, string>) => T | null,
  ): Promise<T> {
    const def = getDefinition(key);
    const credentials = def?.implemented ? await this.connectedCredentials(key) : null;
    const adapter = credentials ? resolve(credentials) : null;
    if (!adapter) throw new DomainError('INTEGRATION_NOT_CONFIGURED', { integration: key });
    return adapter;
  }

  // Real adapters plug into the resolvers below as they land (Phase 2+).
  async payment(key: 'payme' | 'click'): Promise<PaymentProvider> {
    if (this.fakeMode) return this.fakes[key];
    return this.real<PaymentProvider>(key, (c) =>
      key === 'payme' ? new PaymePaymentProvider(c) : new ClickPaymentProvider(c),
    );
  }

  async delivery(key: 'yandex_delivery' | 'bts'): Promise<DeliveryProvider> {
    if (this.fakeMode) return key === 'yandex_delivery' ? this.fakes.yandex : this.fakes.bts;
    return this.real<DeliveryProvider>(key, () => null);
  }

  async sms(): Promise<SmsProvider> {
    return this.fakeMode ? this.fakes.sms : this.real<SmsProvider>('eskiz', () => null);
  }

  async messenger(): Promise<MessengerProvider> {
    return this.fakeMode
      ? this.fakes.messenger
      : this.real<MessengerProvider>('telegram', () => null);
  }

  /** COD receipts fall back to the manual provider (operator enters the receipt) when no OFD is connected. */
  async fiscal(): Promise<FiscalProvider> {
    return this.fakes.fiscal;
  }

  async inventory(): Promise<InventoryProvider> {
    return this.fakeMode
      ? this.fakes.inventory
      : this.real<InventoryProvider>('moysklad', () => null);
  }

  async ai(): Promise<AiProvider> {
    return this.fakeMode ? this.fakes.ai : this.real<AiProvider>('claude', () => null);
  }

  async adSignal(key: AdSignalProvider['key']): Promise<AdSignalProvider> {
    return this.fakeMode
      ? new FakeAdSignalProvider(key)
      : this.real<AdSignalProvider>(key, () => null);
  }

  async list(): Promise<IntegrationView[]> {
    const rows = await this.prisma.integration.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return Promise.all(
      INTEGRATIONS.map(async (definition) => {
        const row = byKey.get(definition.key);
        const creds = row?.credentials ? this.decrypt(definition.key, row.credentials) : {};
        return {
          definition,
          status:
            definition.availability === 'coming_soon'
              ? 'COMING_SOON'
              : ((row?.status as IntegrationView['status']) ?? 'DISCONNECTED'),
          fields: this.maskFields(definition, creds),
          lastCheckAt: row?.lastCheckAt ?? null,
          lastError: row?.lastError ?? null,
          usingFake: this.fakeMode,
        };
      }),
    );
  }

  /** Owner-only (enforced by the admin controller). Stores credentials encrypted, then tests them. */
  async connect(
    key: string,
    input: Record<string, string>,
    staffId: string,
    ip: string | null,
  ): Promise<HealthResult> {
    const def = getDefinition(key);
    if (!def || def.availability === 'coming_soon') throw new DomainError('NOT_FOUND');
    const existing = await this.prisma.integration.findUnique({ where: { key } });
    const previous = existing?.credentials ? this.decrypt(key, existing.credentials) : {};
    // Empty secret inputs keep the stored value (admin form shows masked values only).
    const merged: Record<string, string> = { ...previous };
    for (const f of def.fields) {
      const v = input[f.key];
      if (typeof v === 'string' && v.trim() !== '') merged[f.key] = v.trim();
    }
    const missing = def.fields.filter((f) => f.required && !merged[f.key]).map((f) => f.key);
    if (missing.length) throw new DomainError('VALIDATION_FAILED', { missing }, missing[0]);

    const health = await this.test(key, merged);
    await this.prisma.$transaction([
      this.prisma.integration.upsert({
        where: { key },
        update: {
          credentials: this.seal(merged, key),
          status: health.ok ? 'CONNECTED' : 'ERROR',
          lastCheckAt: new Date(),
          lastError: health.ok ? null : health.message,
        },
        create: {
          key,
          credentials: this.seal(merged, key),
          status: health.ok ? 'CONNECTED' : 'ERROR',
          lastCheckAt: new Date(),
          lastError: health.ok ? null : health.message,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          staffId,
          action: 'integration.update',
          entity: 'Integration',
          entityId: key,
          before: this.maskFields(def, previous),
          after: this.maskFields(def, merged),
          ip,
        },
      }),
    ]);
    return health;
  }

  async disconnect(key: string, staffId: string, ip: string | null): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.integration.upsert({
        where: { key },
        update: { status: 'DISCONNECTED', credentials: null, lastError: null },
        create: { key, status: 'DISCONNECTED' },
      }),
      this.prisma.auditLog.create({
        data: {
          staffId,
          action: 'integration.disconnect',
          entity: 'Integration',
          entityId: key,
          ip,
        },
      }),
    ]);
  }

  async test(key: string, credentials?: Record<string, string>): Promise<HealthResult> {
    const def = getDefinition(key);
    if (!def) return { ok: false, message: 'unknown integration' };
    if (this.fakeMode) {
      return { ok: true, message: 'fake mode: credentials saved, no external call made' };
    }
    const creds = credentials ?? (await this.credentials(key));
    // Payme/Click are inbound protocols (they call us): there is no outbound endpoint to ping, so
    // the check is that what the webhook needs is present. The provider's sandbox run is the
    // real test (docs/runbooks/payments.md).
    if (key === 'payme') {
      return creds.merchantId && paymeAuthKey(creds)
        ? { ok: true, message: `ready: set ${def.webhookPath} as the cashbox endpoint` }
        : { ok: false, message: 'merchantId and the key for the selected mode are required' };
    }
    if (key === 'click') {
      return creds.serviceId && creds.merchantId && creds.secretKey
        ? { ok: true, message: `ready: set ${def.webhookPath}/prepare and /complete in Click` }
        : { ok: false, message: 'serviceId, merchantId and secretKey are required' };
    }
    return { ok: false, message: 'adapter not implemented yet' };
  }

  /** Decrypted credentials for adapters only — never return these from controllers. */
  async credentials(key: string): Promise<Record<string, string>> {
    const row = await this.prisma.integration.findUnique({ where: { key } });
    return row?.credentials ? this.decrypt(key, row.credentials) : {};
  }

  /**
   * Credentials of a CONNECTED integration, else null. Inbound webhooks authenticate against
   * these regardless of PROVIDERS_MODE: a provider can only reach us with the shared secret.
   */
  async connectedCredentials(key: string): Promise<Record<string, string> | null> {
    const row = await this.prisma.integration.findUnique({ where: { key } });
    if (row?.status !== 'CONNECTED' || !row.credentials) return null;
    const creds = this.decrypt(key, row.credentials);
    return Object.keys(creds).length ? creds : null;
  }

  /**
   * Provider-initiated secret change (Payme `ChangePassword`). Audited like an Owner edit, with
   * the provider as actor and masked values only.
   */
  async rotateSecret(key: string, field: string, value: string, actor: string): Promise<void> {
    const def = getDefinition(key);
    if (!def) throw new DomainError('NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "key" FROM "Integration" WHERE "key" = ${key} FOR UPDATE`;
      const row = await tx.integration.findUniqueOrThrow({ where: { key } });
      const previous = row.credentials ? this.decrypt(key, row.credentials) : {};
      const next = { ...previous, [field]: value };
      await tx.integration.update({ where: { key }, data: { credentials: this.seal(next, key) } });
      await tx.auditLog.create({
        data: {
          staffId: null,
          action: 'integration.secret_rotated',
          entity: 'Integration',
          entityId: key,
          before: this.maskFields(def, previous),
          after: { ...this.maskFields(def, next), actor },
        },
      });
    });
  }

  async log(
    key: string,
    entry: {
      direction: 'IN' | 'OUT';
      kind: string;
      ok: boolean;
      message: string;
      payload?: unknown;
    },
  ): Promise<void> {
    await this.prisma.integration.upsert({ where: { key }, update: {}, create: { key } });
    await this.prisma.integrationLog.create({
      data: {
        integrationKey: key,
        direction: entry.direction,
        kind: entry.kind,
        ok: entry.ok,
        message: entry.message.slice(0, 500),
        payload: entry.payload === undefined ? undefined : (redact(entry.payload) as object),
      },
    });
  }

  /** Prisma Bytes needs a plain ArrayBuffer-backed Uint8Array. */
  private seal(value: Record<string, string>, key: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.box.encryptJson(value, key));
  }

  private decrypt(key: string, blob: Uint8Array): Record<string, string> {
    try {
      return this.box.decryptJson<Record<string, string>>(blob, key);
    } catch (e) {
      this.logger.error(`cannot decrypt credentials for ${key}: ${String(e)}`);
      return {};
    }
  }

  private maskFields(
    def: IntegrationDefinition,
    creds: Record<string, string>,
  ): Record<string, string | null> {
    return Object.fromEntries(
      def.fields.map((f) => [
        f.key,
        f.type === 'secret' ? maskSecret(creds[f.key]) : (creds[f.key] ?? null),
      ]),
    );
  }
}
