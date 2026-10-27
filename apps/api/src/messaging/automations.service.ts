import { Inject, Injectable, Logger } from '@nestjs/common';
import { audienceAutoMessageSchema, type Locale, t } from '@forest/contracts';
import { Prisma } from '@forest/db';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CART_LINKS, type CartLinks } from './cart-links';
import { MessageDispatcher } from './dispatcher.service';

const MIN = 60_000;
const DAY = 86_400_000;
/** Older cart episodes are not reminded (the "abandoned" audience covers them). */
const CART_WINDOW_MS = 2 * DAY;
const REVIEW_WINDOW_MS = 14 * DAY;
/** A member who joined long before the step was due is not messaged late. */
const SEGMENT_WINDOW_MS = 7 * DAY;
const BATCH = 300;
export const SAVAT5 = 'SAVAT5';

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] ?? '';
const segmentCursorKey = (segmentId: string) => `messaging.segment:${segmentId}`;

/**
 * Marketing automations (docs/09 flows 3 and 5, waitlist, A8 auto messages). Each run only finds
 * due candidates and enqueues them with a dedupe key; consent, cap, quiet hours and "still
 * relevant" are decided by `MessageDispatcher` at send time.
 */
@Injectable()
export class MessagingAutomations {
  private readonly logger = new Logger('MessagingAutomations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly dispatcher: MessageDispatcher,
    @Inject(CART_LINKS) private readonly cartLinks: CartLinks,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get appUrl(): string {
    return this.env.APP_URL.replace(/\/+$/, '');
  }

  private async delay(key: string, fallbackMin: number): Promise<number | null> {
    const tpl = await this.prisma.messageTemplate.findUnique({
      where: { key },
      select: { active: true, delayMin: true },
    });
    return tpl?.active ? (tpl.delayMin || fallbackMin) * MIN : null;
  }

  /**
   * Flow 3: identified carts left unchanged — Telegram after `cart_abandoned_2h.delayMin` when the
   * customer has a chat; otherwise (or when that reminder wasn't sent) SMS after
   * `cart_abandoned_24h_sms.delayMin`. One reminder per channel per cart episode (`updatedAt`).
   */
  async remindCarts(now = new Date()): Promise<number> {
    const rules = await this.settings.get('messaging.rules');
    if (!rules.scenarios.abandonedCart) return 0;
    const [tgDelay, smsDelay] = await Promise.all([
      this.delay('cart_abandoned_2h', rules.abandonedCartMinutes),
      this.delay('cart_abandoned_24h_sms', 1440),
    ]);
    const delays = [tgDelay, smsDelay].filter((d): d is number => d !== null);
    if (!delays.length) return 0;
    const carts = await this.prisma.cart.findMany({
      where: {
        status: 'ACTIVE',
        customerId: { not: null },
        items: { some: {} },
        updatedAt: {
          gte: new Date(now.getTime() - CART_WINDOW_MS),
          lte: new Date(now.getTime() - Math.min(...delays)),
        },
        customer: { deletedAt: null },
      },
      include: {
        customer: { select: { id: true, name: true, locale: true, telegramId: true } },
        items: {
          include: { variant: { select: { label: true, product: { select: { name: true } } } } },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: BATCH,
    });
    let n = 0;
    for (const cart of carts) {
      const customer = cart.customer!;
      try {
        const ordered = await this.prisma.order.count({
          where: { customerId: customer.id, createdAt: { gt: cart.updatedAt } },
        });
        if (ordered) continue;
        const age = now.getTime() - cart.updatedAt.getTime();
        const episode = `cart:${cart.id}:${cart.updatedAt.getTime()}`;
        const locale = customer.locale;
        const first = cart.items[0]!;
        const name = t(first.variant.product.name as { uz: string; ru: string }, locale);
        const more = cart.items.length - 1;
        const vars = {
          ism: firstName(customer.name),
          mahsulot:
            more > 0 ? `${name} ${locale === 'ru' ? `и ещё ${more}` : `va yana ${more} ta`}` : name,
          kod: SAVAT5,
        };
        const guard = {
          type: 'cart' as const,
          cartId: cart.id,
          updatedAt: cart.updatedAt.toISOString(),
        };
        let tgSent = false;
        if (customer.telegramId && tgDelay !== null) {
          if (age < tgDelay) continue;
          const tg = await this.dispatcher.enqueue({
            templateKey: 'cart_abandoned_2h',
            customerId: customer.id,
            channels: ['TELEGRAM'],
            locale,
            vars: { ...vars, link: await this.cartLink(cart.id, 'abandoned_cart_2h', locale) },
            dedupeKey: `${episode}:tg`,
            flow: { kind: 'abandoned_cart', cartId: cart.id },
            guard,
            now,
          });
          const row =
            tg &&
            (await this.prisma.message.findUnique({
              where: { id: tg.id },
              select: { status: true },
            }));
          tgSent = !!row && ['QUEUED', 'SENT', 'DELIVERED'].includes(row.status);
          if (tg?.outcome === 'SENT') n++;
        }
        if (tgSent || smsDelay === null || age < smsDelay) continue;
        const sms = await this.dispatcher.enqueue({
          templateKey: 'cart_abandoned_24h_sms',
          customerId: customer.id,
          channels: ['SMS'],
          locale,
          vars: { ...vars, link: await this.cartLink(cart.id, 'abandoned_cart_sms', locale) },
          dedupeKey: `${episode}:sms`,
          guard,
          now,
        });
        if (sms?.outcome === 'SENT') n++;
      } catch (e) {
        this.logger.error(`cart reminder ${cart.id} failed: ${String(e)}`);
      }
    }
    return n;
  }

  private async cartLink(cartId: string, campaign: string, locale: Locale): Promise<string> {
    return this.cartLinks.restoreUrl({ cartId, promo: SAVAT5, campaign, locale });
  }

  /**
   * Flow 5: `review_request.delayMin` (3 days) after DELIVERED, once per order without a review:
   * Telegram with stars, else SMS linking the tracking page.
   */
  async requestReviews(now = new Date()): Promise<number> {
    const rules = await this.settings.get('messaging.rules');
    if (!rules.scenarios.reviewRequest) return 0;
    const delay = await this.delay('review_request', rules.reviewRequestDays * 1440);
    if (delay === null) return 0;
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ['DELIVERED', 'COMPLETED'] },
        customer: { deletedAt: null },
        events: {
          some: {
            type: 'STATUS_CHANGED',
            to: 'DELIVERED',
            createdAt: {
              lte: new Date(now.getTime() - delay),
              gte: new Date(now.getTime() - REVIEW_WINDOW_MS),
            },
          },
        },
      },
      include: {
        customer: { select: { id: true, name: true, telegramId: true } },
        items: { take: 1, select: { nameSnapshot: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    const reviewed = new Set(
      (
        await this.prisma.review.findMany({
          where: { orderId: { in: orders.map((o) => o.id) } },
          select: { orderId: true },
        })
      ).map((r) => r.orderId),
    );
    let n = 0;
    for (const order of orders) {
      if (reviewed.has(order.id)) continue;
      try {
        const viaTelegram = !!order.customer.telegramId;
        const res = await this.dispatcher.enqueue({
          templateKey: viaTelegram ? 'review_request' : 'review_request_sms',
          customerId: order.customerId,
          channels: viaTelegram ? ['TELEGRAM'] : ['SMS'],
          locale: order.locale,
          vars: {
            ism: firstName(order.customer.name) || firstName(order.contactName),
            raqam: order.number,
            mahsulot: itemTitle(order.items[0]?.nameSnapshot, order.locale),
            link: `${this.appUrl}/t/${order.trackingToken}`,
          },
          dedupeKey: `review:${order.id}`,
          ...(viaTelegram ? { flow: { kind: 'review_request' as const, orderId: order.id } } : {}),
          guard: { type: 'review', orderId: order.id },
          now,
        });
        if (res?.outcome === 'SENT') n++;
      } catch (e) {
        this.logger.error(`review request ${order.id} failed: ${String(e)}`);
      }
    }
    return n;
  }

  /** Back-in-stock (docs/02): the customer asked for it → `requested` kind, quiet hours only. */
  async notifyWaitlist(now = new Date()): Promise<number> {
    const rules = await this.settings.get('messaging.rules');
    if (!rules.scenarios.waitlist) return 0;
    const entries = await this.prisma.waitlistEntry.findMany({
      where: {
        notifiedAt: null,
        variantId: { not: null },
        product: { status: 'ACTIVE' },
      },
      include: { product: { select: { slug: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      take: BATCH * 3,
    });
    if (!entries.length) return 0;
    const variants = await this.prisma.variant.findMany({
      where: { id: { in: [...new Set(entries.map((e) => e.variantId!))] }, active: true },
      select: { id: true, label: true, stock: true, reserved: true },
    });
    const sellable = new Map(
      variants.filter((v) => v.stock - v.reserved > 0).map((v) => [v.id, v]),
    );
    let n = 0;
    for (const entry of entries) {
      const variant = sellable.get(entry.variantId!);
      if (!variant) continue;
      try {
        const customer = entry.customerId
          ? await this.prisma.customer.findUnique({ where: { id: entry.customerId } })
          : entry.phone
            ? await this.prisma.customer.findUnique({ where: { phone: entry.phone } })
            : null;
        if (customer?.deletedAt) {
          await this.markNotified(entry.id, now);
          continue;
        }
        const locale: Locale = customer?.locale ?? 'uz';
        const name = t(entry.product.name as { uz: string; ru: string }, locale);
        const label = variant.label ? t(variant.label as { uz: string; ru: string }, locale) : '';
        const res = await this.dispatcher.enqueue({
          templateKey: 'waitlist_back',
          customerId: customer?.id ?? null,
          channels: customer?.telegramId ? ['TELEGRAM', 'SMS'] : ['SMS'],
          locale,
          vars: {
            ism: firstName(customer?.name),
            mahsulot: label ? `${name} (${label})` : name,
            link: `${this.appUrl}/${locale}/p/${entry.product.slug}`,
          },
          dedupeKey: `waitlist:${entry.id}`,
          waitlistEntryId: entry.id,
          guard: { type: 'waitlist', variantId: variant.id },
          now,
        });
        // The dedupe key makes a crash between enqueue and this write harmless.
        if (res) await this.markNotified(entry.id, now);
        if (res?.outcome === 'SENT') n++;
      } catch (e) {
        this.logger.error(`waitlist entry ${entry.id} failed: ${String(e)}`);
      }
    }
    return n;
  }

  private markNotified(id: string, now: Date) {
    return this.prisma.waitlistEntry.updateMany({
      where: { id, notifiedAt: null },
      data: { notifiedAt: now },
    });
  }

  /**
   * A8 auto messages: each step of `Segment.autoMessage` goes to members who joined after the
   * automation was switched on (`JobCursor`), `delayMinutes` after joining, while still members.
   */
  async runSegmentMessages(now = new Date()): Promise<number> {
    const segments = await this.prisma.segment.findMany({
      where: { active: true },
      select: { id: true, autoMessage: true },
    });
    let n = 0;
    for (const segment of segments) {
      const parsed = audienceAutoMessageSchema.safeParse(segment.autoMessage);
      const key = segmentCursorKey(segment.id);
      if (!parsed.success || !parsed.data.enabled || !parsed.data.steps.length) {
        await this.prisma.jobCursor.deleteMany({ where: { key } });
        continue;
      }
      const cursor = await this.prisma.jobCursor.upsert({
        where: { key },
        create: { key, ts: now },
        update: {},
      });
      for (const [i, step] of parsed.data.steps.entries()) {
        const dueBefore = new Date(now.getTime() - step.delayMinutes * MIN);
        const windowStart = new Date(dueBefore.getTime() - SEGMENT_WINDOW_MS);
        const since = cursor.ts > windowStart ? cursor.ts : windowStart;
        const members = await this.prisma.$queryRaw<
          { customerId: string; addedAt: Date; name: string | null; locale: Locale }[]
        >(Prisma.sql`
          SELECT m."customerId", m."addedAt", c."name", c."locale"::text AS "locale"
          FROM "SegmentMember" m JOIN "Customer" c ON c."id" = m."customerId"
          WHERE m."segmentId" = ${segment.id} AND m."removedAt" IS NULL AND c."deletedAt" IS NULL
            AND m."addedAt" >= ${since} AND m."addedAt" <= ${dueBefore}
            AND NOT EXISTS (
              SELECT 1 FROM "Message" x WHERE x."dedupeKey" = 'seg:' || m."segmentId" || ':' ||
                m."customerId" || ':' || (extract(epoch from m."addedAt") * 1000)::bigint || ':' || ${String(i)}
            )
          ORDER BY m."addedAt" LIMIT ${BATCH}`);
        for (const m of members) {
          try {
            const res = await this.dispatcher.enqueue({
              templateKey: step.templateKey,
              kind: 'marketing',
              customerId: m.customerId,
              channels: [step.channel === 'telegram' ? 'TELEGRAM' : 'SMS'],
              locale: m.locale,
              vars: { ism: firstName(m.name), link: `${this.appUrl}/${m.locale}` },
              dedupeKey: `seg:${segment.id}:${m.customerId}:${m.addedAt.getTime()}:${i}`,
              guard: { type: 'segment', segmentId: segment.id, addedAt: m.addedAt.toISOString() },
              now,
            });
            if (res?.outcome === 'SENT') n++;
          } catch (e) {
            this.logger.error(
              `audience message ${segment.id}/${m.customerId} failed: ${String(e)}`,
            );
          }
        }
      }
    }
    return n;
  }
}

/** `OrderItem.nameSnapshot`: localized name at order time (plain text in older rows). */
function itemTitle(title: unknown, locale: Locale): string {
  if (typeof title === 'string') return title;
  if (title && typeof title === 'object') return t(title as { uz: string; ru: string }, locale);
  return '';
}
