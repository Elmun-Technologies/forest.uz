import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@forest/contracts';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { redact } from '../common/redact';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { randomBytes } from 'node:crypto';
import { parseMoyskladSettings } from '@forest/contracts';
import { maskSecret, parseKey, SecretBox } from './crypto/secret-box';
import {
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
import { createMoyskladFetch, MoyskladInventoryProvider } from './providers/moysklad';
import {
  EskizSmsProvider,
  EskizTokenCache,
  newEskizCallbackToken,
  redisTokenKv,
} from './providers/eskiz';
import { BtsManualDeliveryProvider } from './providers/bts-manual';
import { ManualFiscalProvider } from './providers/manual-fiscal';
import {
  normalizeBotUsername,
  telegramGetMe,
  telegramSetWebhook,
  telegramWebhookUrl,
} from './providers/telegram';
import { paymeAuthKey, PaymePaymentProvider } from './providers/payme';
import { yandexCallbackUrl, YandexDeliveryProvider } from './providers/yandex-delivery';
import { adsHealth, isAdIntegration } from './providers/ads/health';
import { seoProviderTest } from './providers/seo-factory';
import { ClaudeAiProvider } from './providers/claude';
import { HttpClient } from './http-client';
import type {
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
  /** One client per integration, so its circuit breaker sees every call. */
  private readonly httpClients = new Map<string, HttpClient>();
  /** Eskiz bearer tokens shared via Redis by every API process (single-flight login). */
  private readonly eskizTokens: EskizTokenCache;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    redis: RedisService,
  ) {
    this.eskizTokens = new EskizTokenCache(redisTokenKv(redis));
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
    // BTS has no API yet (docs/13 q.11): manual mode is the real provider, connected or not.
    if (key === 'bts') return new BtsManualDeliveryProvider();
    return this.real<DeliveryProvider>(key, (c) =>
      key === 'yandex_delivery' ? this.yandexDelivery(c) : null,
    );
  }

  async sms(): Promise<SmsProvider> {
    return this.fakeMode ? this.fakes.sms : this.real<SmsProvider>('eskiz', (c) => this.eskiz(c));
  }

  private eskiz(c: Record<string, string>): EskizSmsProvider | null {
    if (!c.email || !c.password || !c.from) return null;
    return new EskizSmsProvider(
      { email: c.email, password: c.password, from: c.from, callbackToken: c.callbackToken },
      {
        http: this.httpClient('eskiz'),
        tokens: this.eskizTokens,
        apiUrl: this.env.ESKIZ_API_URL,
        callbackUrl: c.callbackToken
          ? `${this.env.API_URL.replace(/\/+$/, '')}/v1/webhooks/eskiz/${c.callbackToken}`
          : null,
      },
    );
  }

  /**
   * Bot used by the Telegram Login Widget, from the CONNECTED `telegram` integration in every
   * PROVIDERS_MODE (inbound auth, like webhooks); null → the widget is unavailable.
   */
  async telegramLogin(): Promise<{ botToken: string; botUsername: string } | null> {
    const c = await this.connectedCredentials('telegram');
    const botUsername = normalizeBotUsername(c?.botUsername ?? '');
    return c?.botToken && botUsername ? { botToken: c.botToken, botUsername } : null;
  }

  async messenger(): Promise<MessengerProvider> {
    return this.fakeMode
      ? this.fakes.messenger
      : this.real<MessengerProvider>('telegram', () => null);
  }

  /**
   * COD receipts fall back to the manual provider (operator enters the receipt) while no OFD
   * adapter exists — the documented MVP fallback (docs/06 Fiscal), not a fake.
   */
  async fiscal(): Promise<FiscalProvider> {
    return this.fakeMode ? this.fakes.fiscal : new ManualFiscalProvider();
  }

  async inventory(): Promise<InventoryProvider> {
    return this.fakeMode
      ? this.fakes.inventory
      : this.real<InventoryProvider>('moysklad', (c) => this.moysklad(c));
  }

  /** Real MoySklad adapter: own fetch wrapper keeps its rate limits (≤ 2 parallel, 429 waits). */
  private moysklad(c: Record<string, string>): MoyskladInventoryProvider | null {
    if (!c.token) return null;
    let http = this.httpClients.get('moysklad');
    if (!http) {
      http = new HttpClient('moysklad', { maxRetries: 2, fetchImpl: createMoyskladFetch() });
      this.httpClients.set('moysklad', http);
    }
    return new MoyskladInventoryProvider(c, { http, baseUrl: this.env.MOYSKLAD_API_URL });
  }

  async ai(): Promise<AiProvider> {
    return this.fakeMode ? this.fakes.ai : this.real<AiProvider>('claude', (c) => this.claude(c));
  }

  /** Real Claude adapter (AI drafts, CLAUDE.md §6); model from the integration's `model` field. */
  private claude(c: Record<string, string>): ClaudeAiProvider | null {
    return c.apiKey ? new ClaudeAiProvider({ apiKey: c.apiKey, model: c.model }) : null;
  }

  /** `key` names the breaker; a provider may use a second one (`<integration>:<purpose>`). */
  httpClient(key: string, options: { maxRetries?: number } = {}): HttpClient {
    let client = this.httpClients.get(key);
    if (!client) {
      client = new HttpClient(key, { maxRetries: options.maxRetries ?? 2 });
      this.httpClients.set(key, client);
    }
    return client;
  }

  /** Real Yandex adapter; mutating calls and failures land in IntegrationLog (summaries only). */
  private yandexDelivery(credentials: Record<string, string>): YandexDeliveryProvider {
    return new YandexDeliveryProvider(credentials, {
      http: this.httpClient('yandex_delivery'),
      // Checkout quotes must answer fast or fall back to the zone price: no retries, own breaker.
      quoteHttp: this.httpClient('yandex_delivery:quote', { maxRetries: 0 }),
      baseUrl: this.env.YANDEX_DELIVERY_API_URL,
      callbackUrl: yandexCallbackUrl(this.env.API_URL, this.env.APP_ENCRYPTION_KEY),
      log: (e) =>
        void this.log('yandex_delivery', { direction: 'OUT', ...e }).catch((err: unknown) =>
          this.logger.warn(`integration log failed: ${String(err)}`),
        ),
    });
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
    // Fields not sent stay as stored. A blank secret keeps the stored value (the admin form shows
    // masked values only); a blank non-secret field clears it (e.g. optional coordinates).
    const merged: Record<string, string> = { ...previous };
    for (const f of def.fields) {
      const v = input[f.key];
      if (typeof v !== 'string') continue;
      const value = v.trim();
      if (value !== '') merged[f.key] = value;
      else if (f.type !== 'secret') delete merged[f.key];
    }
    const missing = def.fields.filter((f) => f.required && !merged[f.key]).map((f) => f.key);
    if (missing.length) throw new DomainError('VALIDATION_FAILED', { missing }, missing[0]);
    // Eskiz callbacks are unsigned: the secret lives in the callback URL (CLAUDE.md §6).
    if (key === 'eskiz' && !merged.callbackToken) merged.callbackToken = newEskizCallbackToken();
    // MoySklad webhooks are unsigned too: secret path token (CLAUDE.md §6).
    if (key === 'moysklad' && !merged.webhookToken)
      merged.webhookToken = randomBytes(24).toString('base64url');
    // Telegram bot webhook: secret path segment + `secret_token` header (CLAUDE.md §6, 5A).
    if (key === 'telegram' && !merged.webhookSecret)
      merged.webhookSecret = randomBytes(32).toString('base64url');

    let health = await this.test(key, merged);
    if (key === 'telegram' && health.ok && !this.fakeMode)
      health = await this.telegramWebhook(merged, health);
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

  /**
   * Points the bot's webhook at us after a successful getMe. A failure keeps the integration
   * CONNECTED (the login widget works without it) but is shown in `lastError`'s message and
   * logged (`webhook.set`), which raises an admin alert.
   */
  private async telegramWebhook(
    creds: Record<string, string>,
    health: HealthResult,
  ): Promise<HealthResult> {
    const res = await telegramSetWebhook(
      this.httpClient('telegram'),
      creds.botToken ?? '',
      telegramWebhookUrl(this.env.API_URL, creds.webhookSecret ?? ''),
      creds.webhookSecret ?? '',
    );
    await this.log('telegram', {
      direction: 'OUT',
      kind: 'webhook.set',
      ok: res.ok,
      message: res.message,
    }).catch((e: unknown) => this.logger.warn(`integration log failed: ${String(e)}`));
    return res.ok ? health : { ok: true, message: `${health.message}; ${res.message}` };
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
    if (key === 'yandex_delivery') return this.yandexDelivery(creds).test();
    if (key === 'eskiz') {
      const eskiz = this.eskiz(creds);
      return eskiz ? eskiz.test() : { ok: false, message: 'email, password and from are required' };
    }
    if (key === 'moysklad') {
      const ms = this.moysklad(creds);
      if (!ms) return { ok: false, message: 'token is required' };
      const row = await this.prisma.integration.findUnique({
        where: { key },
        select: { config: true },
      });
      return ms.test(parseMoyskladSettings(row?.config));
    }
    if (key === 'telegram')
      return telegramGetMe(this.httpClient('telegram'), creds.botToken ?? '', creds.botUsername);
    if (key === 'claude') {
      const claude = this.claude(creds);
      return claude ? claude.test() : { ok: false, message: 'apiKey is required' };
    }
    if (key === 'gsc' || key === 'ywm' || key === 'pagespeed')
      return seoProviderTest(key, creds, this.httpClient(key, { maxRetries: 0 }));
    if (isAdIntegration(key)) return adsHealth(key, creds, this.httpClient(`${key}:health`));
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
