import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { signDeepLink, telegramDeepLink, verifyDeepLink } from '../customer/deeplink';
import { RedisService } from '../redis/redis.module';
import { TelegramGateway } from './telegram-gateway.service';

/** What a `/start` payload tells the bot. */
export interface StartRef {
  source: string | null;
  anonymousId: string | null;
  /** Order tracking token (signed `o` payload). */
  orderToken: string | null;
}

const REF_TTL_SEC = 30 * 24 * 3600;
const SRC_RE = /^[a-z0-9_]{1,16}$/;
const AID_RE = /^[\w-]{10,64}$/;

/**
 * Site → bot deep links (CLAUDE.md §6, 5A): the storefront's `/tg?s=<src>` asks for a start link;
 * the visitor (`fr_aid`) and source go into Redis `tg:ref:<id>` and the payload carries only the
 * signed 12-char reference.
 */
@Injectable()
export class StartLinksService {
  constructor(
    private readonly redis: RedisService,
    private readonly gateway: TelegramGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** `https://t.me/<bot>?start=<payload>`; null when no bot username is known. */
  async startUrl(src: string, anonymousId: string | null): Promise<string | null> {
    const config = await this.gateway.config();
    if (!config) return null;
    const source = SRC_RE.test(src) ? src : 'site';
    if (!anonymousId || !AID_RE.test(anonymousId)) return telegramDeepLink(config.username, source);
    const id = randomBytes(9).toString('base64url');
    await this.redis.set(
      `tg:ref:${id}`,
      JSON.stringify({ src: source, aid: anonymousId }),
      'EX',
      REF_TTL_SEC,
    );
    return telegramDeepLink(
      config.username,
      signDeepLink({ kind: 'ref', id }, this.env.SESSION_SECRET),
    );
  }

  /** Never throws: an unknown/forged payload is a plain `/start` with no source. */
  async resolve(payload: string): Promise<StartRef> {
    const none: StartRef = { source: null, anonymousId: null, orderToken: null };
    const p = payload.trim();
    if (!p) return none;
    const signed = verifyDeepLink(p, this.env.SESSION_SECRET);
    if (signed?.kind === 'lead') return { ...none, source: signed.src };
    if (signed?.kind === 'order') return { ...none, source: 'order', orderToken: signed.token };
    if (signed?.kind === 'ref') {
      const raw = await this.redis.get(`tg:ref:${signed.id}`).catch(() => null);
      if (!raw) return { ...none, source: 'site' };
      try {
        const v = JSON.parse(raw) as { src?: string; aid?: string };
        return {
          source: v.src && SRC_RE.test(v.src) ? v.src : 'site',
          anonymousId: v.aid && AID_RE.test(v.aid) ? v.aid : null,
          orderToken: null,
        };
      } catch {
        return { ...none, source: 'site' };
      }
    }
    return SRC_RE.test(p) ? { ...none, source: p } : none;
  }
}
