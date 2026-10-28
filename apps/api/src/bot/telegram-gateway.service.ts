import { Inject, Injectable, Logger } from '@nestjs/common';
import { Api } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { timingSafeEqual } from 'node:crypto';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { IntegrationsService } from '../integrations/integrations.service';
import { normalizeBotUsername, TELEGRAM_API_URL } from '../integrations/providers/telegram';
import { SettingsService } from '../settings/settings.service';
import { FakeTelegramTransport } from './fake-telegram';

/** What the bot needs from the `telegram` integration (or the fake transport). */
export interface BotConfig {
  token: string;
  username: string;
  /** Webhook path/header secret; null = no webhook accepted. */
  webhookSecret: string | null;
  /** Admin alerts group chat id (integration field); null = alerts off. */
  adminChatId: string | null;
  fake: boolean;
}

/** Token stand-in for the fake transport (never reaches Telegram). */
const FAKE_TOKEN = 'fake-transport';
const MAX_DOWNLOAD = 20 * 1024 * 1024;

/**
 * Transport abstraction for the bot (CLAUDE.md §6, 5A): builds grammY `Api` clients against the
 * real Bot API for the CONNECTED `telegram` integration, or against `FakeTelegramTransport` in
 * PROVIDERS_MODE=fake. Inbound webhooks authenticate against the connected integration's secret
 * in every mode (like the other webhooks).
 */
@Injectable()
export class TelegramGateway {
  private readonly logger = new Logger('TelegramGateway');
  readonly fake: FakeTelegramTransport;
  private readonly apis = new Map<string, Api>();

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.fake = new FakeTelegramTransport((chatId, text) =>
      integrations.outbox.push({ channel: 'telegram', to: chatId, text }),
    );
  }

  get fakeMode(): boolean {
    return this.integrations.fakeMode;
  }

  /** Null when the bot can't talk (not connected outside fake mode). */
  async config(): Promise<BotConfig | null> {
    const creds = await this.integrations.connectedCredentials('telegram');
    const adminChatId = creds?.adminChatId?.trim() || null;
    const webhookSecret = creds?.webhookSecret || null;
    if (this.fakeMode) {
      const store = await this.settings.get('store.info').catch(() => null);
      const username =
        normalizeBotUsername(creds?.botUsername ?? '') ||
        normalizeBotUsername(store?.telegramBot ?? '') ||
        'forest_uz_bot';
      return { token: FAKE_TOKEN, username, webhookSecret, adminChatId, fake: true };
    }
    const username = normalizeBotUsername(creds?.botUsername ?? '');
    if (!creds?.botToken || !username) return null;
    return { token: creds.botToken, username, webhookSecret, adminChatId, fake: false };
  }

  /** grammY Api for the current configuration (cached per token). */
  async api(): Promise<{ api: Api; config: BotConfig } | null> {
    const config = await this.config();
    if (!config) return null;
    return { api: this.apiFor(config), config };
  }

  apiFor(config: BotConfig): Api {
    let api = this.apis.get(config.token);
    if (!api) {
      api = new Api(config.token);
      this.install(api, config);
      this.apis.set(config.token, api);
    }
    return api;
  }

  /** The fake transport replaces the network for every API call of this client. */
  install(api: Api, config: BotConfig): void {
    if (config.fake) api.config.use(this.fake.transformer);
  }

  /** `getMe` result without a network call (grammY needs it to route updates). */
  botInfo(config: BotConfig): UserFromGetMe {
    const id = Number(config.token.split(':')[0]) || 1;
    return {
      id,
      is_bot: true,
      first_name: 'Forest',
      username: config.username,
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    } as UserFromGetMe;
  }

  /** Constant-time check of the path secret and the `X-Telegram-Bot-Api-Secret-Token` header. */
  async authenticate(pathSecret: string, header: string | undefined): Promise<BotConfig | null> {
    const config = await this.config();
    const expected = config?.webhookSecret;
    if (!config || !expected) return null;
    return safeEqual(pathSecret, expected) && safeEqual(header ?? '', expected) ? config : null;
  }

  /** Downloads a file the customer sent (getFile → file/bot<token>/<path>), ≤ 20 MB. */
  async download(fileId: string): Promise<Buffer | null> {
    const ctx = await this.api();
    if (!ctx) return null;
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path || (file.file_size ?? 0) > MAX_DOWNLOAD) return null;
    if (ctx.config.fake) return this.fake.download(file.file_path);
    return fetchBytes(`${TELEGRAM_API_URL}/file/bot${ctx.config.token}/${file.file_path}`);
  }

  /** Bot links to the site carry these UTM tags (channel `telegram`, medium `bot`). */
  siteUrl(path: string, campaign: string): string {
    const url = new URL(path, this.env.APP_URL);
    url.searchParams.set('utm_source', 'telegram');
    url.searchParams.set('utm_medium', 'bot');
    url.searchParams.set('utm_campaign', campaign);
    return url.toString();
  }

  warn(message: string): void {
    this.logger.warn(message);
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Plain fetch with a timeout and a size cap (the token is in the URL: never logged). */
async function fetchBytes(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`telegram file download: HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_DOWNLOAD) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > MAX_DOWNLOAD ? null : buf;
}
