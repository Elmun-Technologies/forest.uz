import { randomBytes } from 'node:crypto';
import { fromTashkent, tashkentDayStart, toTashkentParts } from '@forest/contracts';
import { Prisma } from '@forest/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { NotificationsService } from '../src/commerce/notifications.service';
import { MessagingAutomations } from '../src/messaging/automations.service';
import { MessageDispatcher } from '../src/messaging/dispatcher.service';
import {
  MARKETING_STOP_CALLBACK,
  TELEGRAM_SENDER,
  type TelegramOutbound,
  type TelegramSender,
} from '../src/messaging/telegram-sender';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/settings/settings.service';
import { createAdminTestApp, signedIn, type AdminClient } from './admin-helpers';
import { nextTestIp } from './app';

/** Fake Telegram transport: records every message; `failNext` simulates a blocked chat. */
class FakeTelegram implements TelegramSender {
  sent: TelegramOutbound[] = [];
  failNext = false;
  async sendMessage(input: TelegramOutbound) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('blocked');
    }
    this.sent.push(input);
    return { messageId: String(this.sent.length) };
  }
  to(chatId: bigint) {
    return this.sent.filter((m) => m.chatId === String(chatId));
  }
}

const H = 3_600_000;
const D = 24 * H;
/** Fixed clock 20 days ahead (12:00 Tashkent): nothing real-time in the shared DB is due then. */
const base = (() => {
  const p = toTashkentParts(tashkentDayStart(new Date(), 20));
  return fromTashkent(p.year, p.month, p.day, 12, 0);
})();
const at = (ms: number) => new Date(base.getTime() + ms);
const phone = () => `+99890${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
const chat = () => BigInt(1_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
const run = randomBytes(4).toString('hex');

describe('messaging engine: policy, automations, opt-out (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let automations: MessagingAutomations;
  let dispatcher: MessageDispatcher;
  let integrations: IntegrationsService;
  const telegram = new FakeTelegram();
  const customerIds: string[] = [];
  const segmentIds: string[] = [];
  let variant: {
    id: string;
    sku: string;
    productId: string;
    priceTiyin: bigint;
    product: { sellerId: string; name: unknown; slug: string };
  };
  let savedTemplates: { key: string; smsApproved: boolean; active: boolean; delayMin: number }[];
  let savedRules: unknown;

  async function customer(
    opts: { telegram?: boolean; sms?: boolean; tg?: boolean; name?: string } = {},
  ) {
    const c = await prisma.customer.create({
      data: {
        phone: phone(),
        name: opts.name ?? 'Dilnoza Yusupova',
        telegramId: opts.telegram ? chat() : null,
        tags: [`msg-${run}`],
      },
    });
    customerIds.push(c.id);
    const rows = [
      ...(opts.sms
        ? [{ customerId: c.id, channel: 'SMS_MARKETING' as const, granted: true, source: 'test' }]
        : []),
      ...(opts.tg
        ? [{ customerId: c.id, channel: 'TELEGRAM' as const, granted: true, source: 'test' }]
        : []),
    ];
    if (rows.length)
      await prisma.consent.createMany({
        data: rows.map((r) => ({ ...r, createdAt: at(-30 * D) })),
      });
    return c;
  }

  async function cart(customerId: string, updatedAt: Date) {
    const c = await prisma.cart.create({
      data: { customerId, items: { create: { variantId: variant.id, qty: 1 } } },
    });
    await prisma.$executeRaw`UPDATE "Cart" SET "updatedAt" = ${updatedAt} WHERE "id" = ${c.id}`;
    return prisma.cart.findUniqueOrThrow({ where: { id: c.id } });
  }

  async function deliveredOrder(customerId: string, contactPhone: string, deliveredAt: Date) {
    const order = await prisma.order.create({
      data: {
        publicId: `msg-${run}-${customerId}`,
        trackingToken: `m${randomBytes(5).toString('hex')}`,
        customerId,
        status: 'DELIVERED',
        contactName: 'Dilnoza',
        contactPhone,
        address: { region: 'tashkent', line: '—' },
        subtotalTiyin: variant.priceTiyin,
        totalTiyin: variant.priceTiyin,
        paymentMethod: 'COD',
        deliveryZone: 'tashkent',
        carrier: 'YANDEX',
        offerVersion: '1',
        createdAt: at(-6 * D),
        items: {
          create: {
            variantId: variant.id,
            sellerId: variant.product.sellerId,
            nameSnapshot: variant.product.name ?? {},
            sku: variant.sku,
            ikpu: '03209001001000000',
            vatPercent: 12,
            qty: 1,
            priceTiyin: variant.priceTiyin,
          },
        },
      },
    });
    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        type: 'STATUS_CHANGED',
        from: 'HANDED_TO_COURIER',
        to: 'DELIVERED',
        actorType: 'SYSTEM',
        createdAt: deliveredAt,
      },
    });
    return order;
  }

  const messages = (customerId: string) =>
    prisma.message.findMany({
      where: { customerId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  beforeAll(async () => {
    app = await createAdminTestApp([], {}, (b) =>
      b.overrideProvider(TELEGRAM_SENDER).useValue(telegram),
    );
    prisma = app.get(PrismaService);
    automations = app.get(MessagingAutomations);
    dispatcher = app.get(MessageDispatcher);
    integrations = app.get(IntegrationsService);
    variant = await prisma.variant.findUniqueOrThrow({
      where: { sku: 'FR-CW-1000' },
      include: { product: { select: { sellerId: true, name: true, slug: true } } },
    });
    savedTemplates = await prisma.messageTemplate.findMany({
      select: { key: true, smsApproved: true, active: true, delayMin: true },
    });
    savedRules = (await prisma.setting.findUniqueOrThrow({ where: { key: 'messaging.rules' } }))
      .value;
    // The owner has approved these SMS texts in Eskiz (the migration leaves new texts unapproved).
    await prisma.messageTemplate.updateMany({
      where: { key: { in: ['cart_abandoned_24h_sms', 'review_request_sms', 'waitlist_back'] } },
      data: { smsApproved: true },
    });
  });

  afterAll(async () => {
    for (const t of savedTemplates)
      await prisma.messageTemplate.update({
        where: { key: t.key },
        data: { smsApproved: t.smsApproved, active: t.active, delayMin: t.delayMin },
      });
    await prisma.messageTemplate.deleteMany({ where: { key: { startsWith: `custom_t${run}` } } });
    await prisma.setting.update({
      where: { key: 'messaging.rules' },
      data: { value: savedRules as object },
    });
    await prisma.jobCursor.deleteMany({
      where: { key: { in: segmentIds.map((id) => `messaging.segment:${id}`) } },
    });
    await prisma.segment.deleteMany({ where: { id: { in: segmentIds } } });
    await prisma.waitlistEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.message.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.review.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.order.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.cart.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.consent.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    app.get(SettingsService).invalidate();
    await app.close();
  });

  it('abandoned cart: Telegram with SAVAT5 and the opt-out button after 2 h, once per episode', async () => {
    const c = await customer({ telegram: true, tg: true });
    const k = await cart(c.id, at(-3 * H));
    await automations.remindCarts(base);
    await automations.remindCarts(at(5 * 60_000));
    const sent = telegram.to(c.telegramId!);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('SAVAT5');
    expect(sent[0]!.text.startsWith('Dilnoza, savatingizda qoldi')).toBe(true);
    expect(sent[0]!.flow).toEqual({ kind: 'abandoned_cart', cartId: k.id });
    expect(sent[0]!.buttons?.flat().map((b) => b.callbackData ?? b.url)).toContain(
      MARKETING_STOP_CALLBACK,
    );
    const rows = await messages(c.id);
    expect(rows.map((r) => [r.templateKey, r.status, r.kind])).toEqual([
      ['cart_abandoned_2h', 'SENT', 'marketing'],
    ]);
    // Customers with a sent Telegram reminder get no 24 h SMS.
    await automations.remindCarts(at(22 * H));
    expect(await messages(c.id)).toHaveLength(1);
  });

  it('daily cap holds across channels: a second marketing message the same day is skipped', async () => {
    const c = await customer({ telegram: true, tg: true, sms: true });
    await cart(c.id, at(-3 * H));
    await automations.remindCarts(base);
    // Same Tashkent day, other channel: an SMS marketing message would be the 2nd one.
    const order = await deliveredOrder(c.id, c.phone!, at(-4 * D));
    await dispatcher.enqueue({
      templateKey: 'review_request_sms',
      customerId: c.id,
      channels: ['SMS'],
      vars: { ism: 'Dilnoza', raqam: order.number, link: 'https://forest.test/t/x' },
      dedupeKey: `cap-test:${order.id}`,
      now: at(3 * H),
    });
    const rows = await messages(c.id);
    expect(rows.map((r) => [r.templateKey, r.channel, r.status])).toEqual([
      ['cart_abandoned_2h', 'TELEGRAM', 'SENT'],
      ['review_request_sms', 'SMS', 'SKIPPED_CAP'],
    ]);
    expect(integrations.outbox.list(c.phone!)).toHaveLength(0);
    // Next Tashkent day the cap is free again.
    await dispatcher.enqueue({
      templateKey: 'review_request_sms',
      customerId: c.id,
      channels: ['SMS'],
      vars: { ism: 'Dilnoza', raqam: order.number, link: 'https://forest.test/t/x' },
      dedupeKey: `cap-test2:${order.id}`,
      now: at(22 * H),
    });
    expect(integrations.outbox.list(c.phone!)).toHaveLength(1);
  });

  it('quiet hours defer to 09:00 (not dropped); the flush re-decides and sends then', async () => {
    const night = at(10 * H); // 22:00
    const c = await customer({ telegram: true, tg: true });
    await cart(c.id, at(6 * H));
    await automations.remindCarts(night);
    const [row] = await messages(c.id);
    expect(row).toMatchObject({ status: 'QUEUED', claimedAt: null });
    expect(row!.sendAfter).toEqual(at(21 * H)); // next day 09:00
    expect(telegram.to(c.telegramId!)).toHaveLength(0);
    await dispatcher.flushDue(at(21 * H - 60_000));
    expect(telegram.to(c.telegramId!)).toHaveLength(0);
    await dispatcher.flushDue(at(21 * H));
    expect(telegram.to(c.telegramId!)).toHaveLength(1);
    expect((await messages(c.id))[0]).toMatchObject({ status: 'SENT', sentAt: at(21 * H) });
  });

  it('a deferred reminder is skipped at 09:00 when the customer ordered in the meantime', async () => {
    const c = await customer({ telegram: true, tg: true });
    await cart(c.id, at(6 * H));
    await automations.remindCarts(at(10 * H));
    await deliveredOrder(c.id, c.phone!, at(12 * H)); // an order created after the cart change
    await prisma.order.updateMany({ where: { customerId: c.id }, data: { createdAt: at(12 * H) } });
    await dispatcher.flushDue(at(21 * H));
    expect(telegram.to(c.telegramId!)).toHaveLength(0);
    expect((await messages(c.id))[0]).toMatchObject({ status: 'SKIPPED' });
    expect((await messages(c.id))[0]!.error).toContain('ordered since');
  });

  it('no Telegram: 24 h SMS with the opt-out link; the link revokes SMS marketing', async () => {
    const c = await customer({ sms: true });
    await cart(c.id, at(-25 * H));
    await automations.remindCarts(base);
    const sms = integrations.outbox.list(c.phone!);
    expect(sms).toHaveLength(1);
    expect(sms[0]!.text).toContain('SAVAT5');
    const link = /\/uz\/obuna\/([A-Za-z0-9_-]+)/.exec(sms[0]!.text);
    expect(link).not.toBeNull();

    await request(app.getHttpServer())
      .post('/v1/messaging/unsubscribe')
      .set('X-Forwarded-For', nextTestIp())
      .send({ token: link![1] })
      .expect(200, { channel: 'sms' });
    const consent = await prisma.consent.findFirst({
      where: { customerId: c.id, channel: 'SMS_MARKETING' },
      orderBy: { createdAt: 'desc' },
    });
    expect(consent).toMatchObject({ granted: false, source: 'unsubscribe' });

    // Opted out: the next episode's SMS is not sent.
    await prisma.cart.updateMany({ where: { customerId: c.id }, data: { status: 'CONVERTED' } });
    const k2 = await cart(c.id, at(-23 * H));
    await automations.remindCarts(at(2 * H));
    const last = (await messages(c.id)).find((m) => m.dedupeKey?.startsWith(`cart:${k2.id}`));
    expect(last).toMatchObject({ status: 'SKIPPED_NO_CONSENT' });
    expect(integrations.outbox.list(c.phone!)).toHaveLength(1);

    await request(app.getHttpServer())
      .post('/v1/messaging/unsubscribe')
      .set('X-Forwarded-For', nextTestIp())
      .send({ token: `${link![1]!.slice(0, -2)}xx` })
      .expect(400);
  });

  it('review request: Telegram flow 5 for chat customers, SMS with the tracking link otherwise', async () => {
    const tg = await customer({ telegram: true, tg: true });
    const viaSms = await customer({ sms: true, name: '' });
    const o1 = await deliveredOrder(tg.id, tg.phone!, at(-3 * D - H));
    const o2 = await deliveredOrder(viaSms.id, viaSms.phone!, at(-3 * D - H));
    const notYet = await customer({ telegram: true, tg: true });
    await deliveredOrder(notYet.id, notYet.phone!, at(-2 * D));
    await automations.requestReviews(base);
    await automations.requestReviews(at(60_000));

    const sent = telegram.to(tg.telegramId!);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.flow).toEqual({ kind: 'review_request', orderId: o1.id });
    expect(sent[0]!.text.startsWith('Dilnoza, natija qanday chiqdi?')).toBe(true);
    const sms = integrations.outbox.list(viaSms.phone!);
    expect(sms).toHaveLength(1);
    expect(sms[0]!.text).toContain(`/t/${o2.trackingToken}`);
    expect(sms[0]!.text).toContain(o2.number);
    expect(telegram.to(notYet.telegramId!)).toHaveLength(0);
  });

  it('waitlist: notified once when stock returns, without marketing consent', async () => {
    const c = await customer({});
    const before = await prisma.variant.findUniqueOrThrow({
      where: { id: variant.id },
      select: { stock: true, reserved: true },
    });
    await prisma.variant.update({ where: { id: variant.id }, data: { stock: before.reserved } });
    const entry = await prisma.waitlistEntry.create({
      data: {
        productId: variant.productId,
        variantId: variant.id,
        phone: c.phone,
        customerId: c.id,
        channel: 'SMS',
      },
    });
    try {
      await automations.notifyWaitlist(base);
      expect(integrations.outbox.list(c.phone!)).toHaveLength(0);
      await prisma.variant.update({
        where: { id: variant.id },
        data: { stock: before.reserved + 3 },
      });
      await automations.notifyWaitlist(base);
      await automations.notifyWaitlist(at(60_000));
      const sms = integrations.outbox.list(c.phone!);
      expect(sms).toHaveLength(1);
      expect(sms[0]!.text).toContain(`/uz/p/${variant.product.slug}`);
      expect(sms[0]!.text).not.toContain('obuna'); // requested, not marketing
      expect(
        (await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } })).notifiedAt,
      ).toEqual(base);
    } finally {
      await prisma.variant.update({ where: { id: variant.id }, data: { stock: before.stock } });
    }
  });

  it('audience auto message: only members added after it was switched on, after the delay', async () => {
    const key = `custom_t${run}`;
    await prisma.messageTemplate.create({
      data: {
        key,
        body: {
          uz: '{ism}, siz uchun yangi to‘plamlar: {link}',
          ru: '{ism}, новые наборы: {link}',
        },
      },
    });
    const tag = `msg-${run}`;
    const segment = await prisma.segment.create({
      data: {
        name: `msg ${run}`,
        rules: { groups: [{ conditions: [{ type: 'tag', tag, has: true }] }] },
        autoMessage: {
          enabled: true,
          steps: [{ channel: 'telegram', delayMinutes: 60, templateKey: key }],
        },
        destinations: [],
      },
    });
    segmentIds.push(segment.id);
    const t0 = at(-5 * H);
    await prisma.jobCursor.create({ data: { key: `messaging.segment:${segment.id}`, ts: t0 } });
    const old = await customer({ telegram: true, tg: true });
    const fresh = await customer({ telegram: true, tg: true });
    const tooSoon = await customer({ telegram: true, tg: true });
    for (const [c, addedAt] of [
      [old, at(-6 * H)],
      [fresh, at(-2 * H)],
      [tooSoon, at(-30 * 60_000)],
    ] as const)
      await prisma.segmentMember.upsert({
        where: { segmentId_customerId: { segmentId: segment.id, customerId: c.id } },
        create: { segmentId: segment.id, customerId: c.id, addedAt },
        update: { addedAt, removedAt: null },
      });
    await automations.runSegmentMessages(base);
    await automations.runSegmentMessages(at(60_000));
    expect(telegram.to(old.telegramId!)).toHaveLength(0);
    expect(telegram.to(tooSoon.telegramId!)).toHaveLength(0);
    const sent = telegram.to(fresh.telegramId!);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toMatch(/^Dilnoza, siz uchun yangi to‘plamlar: https?:\/\/.+\/uz$/);
    expect(sent[0]!.buttons?.flat().some((b) => b.callbackData === MARKETING_STOP_CALLBACK)).toBe(
      true,
    );
  });

  it('service messages ignore consent, cap and quiet hours; a blocked chat falls back to SMS', async () => {
    const c = await customer({ telegram: true });
    const order = await deliveredOrder(c.id, c.phone!, at(-D));
    telegram.failNext = true;
    await app.get(NotificationsService).orderStatus(order.id, 'order_delivered');
    const rows = await messages(c.id);
    expect(rows.map((r) => [r.channel, r.status, r.kind])).toEqual([
      ['TELEGRAM', 'FAILED', 'service'],
      ['SMS', 'SENT', 'service'],
    ]);
    expect(integrations.outbox.list(c.phone!)).toHaveLength(1);
    const events = await prisma.orderEvent.findMany({
      where: { orderId: order.id, type: 'NOTIFICATION_SENT' },
    });
    expect(events).toHaveLength(1);
  });

  it('a row whose first attempt never ran is retried by the flush (≤ 1 h), older ones expire', async () => {
    const c = await customer({});
    const order = await deliveredOrder(c.id, c.phone!, at(-D));
    const orphan = (createdAt: Date) =>
      prisma.message.create({
        data: {
          customerId: c.id,
          channel: 'SMS',
          templateKey: 'order_delivered',
          body: 'Yetkazildi.',
          kind: 'service',
          payload: { locale: 'uz', orderId: order.id },
          createdAt,
        },
      });
    const fresh = await orphan(base);
    const old = await orphan(at(-2 * H));
    await dispatcher.flushDue(at(60_000));
    expect((await prisma.message.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe(
      'QUEUED',
    );
    await dispatcher.flushDue(at(3 * 60_000));
    expect((await prisma.message.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe(
      'SENT',
    );
    expect(await prisma.message.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({
      status: 'SKIPPED',
    });
    expect(integrations.outbox.list(c.phone!)).toHaveLength(1);
  });

  it('unapproved SMS texts are never sent', async () => {
    await prisma.messageTemplate.update({
      where: { key: 'cart_abandoned_24h_sms' },
      data: { smsApproved: false },
    });
    const c = await customer({ sms: true });
    await cart(c.id, at(-25 * H));
    await automations.remindCarts(base);
    expect(integrations.outbox.list(c.phone!)).toHaveLength(0);
    expect((await messages(c.id))[0]).toMatchObject({
      status: 'SKIPPED',
      error: 'sms text not approved',
    });
    await prisma.messageTemplate.update({
      where: { key: 'cart_abandoned_24h_sms' },
      data: { smsApproved: true },
    });
  });

  describe('A12 admin', () => {
    let marketer: AdminClient;
    let staffId: string;

    beforeAll(async () => {
      const s = await signedIn(app, 'MARKETER');
      marketer = s.client;
      staffId = s.id;
    });

    it('lists templates with their variables; edits are validated and audited', async () => {
      const list = await marketer.get('/v1/admin/messaging/templates');
      expect(list.status).toBe(200);
      const cartTpl = (list.body as { key: string; vars: string[] }[]).find(
        (t) => t.key === 'cart_abandoned_2h',
      );
      expect(cartTpl?.vars).toEqual(['ism', 'mahsulot', 'kod', 'link']);

      const original = await prisma.messageTemplate.findUniqueOrThrow({
        where: { key: 'cart_abandoned_2h' },
      });
      const body = {
        body: {
          uz: '{ism}, savatda {mahsulot} qoldi. {kod}',
          ru: '{ism}, в корзине {mahsulot}. {kod}',
        },
        buttons: [{ text: { uz: 'Yakunlash', ru: 'Завершить' }, url: '{link}' }],
        delayMin: 90,
        smsFallback: false,
        smsApproved: false,
        active: true,
      };
      const bad = await marketer.send('patch', '/v1/admin/messaging/templates/cart_abandoned_2h', {
        ...body,
        body: { ...body.body, uz: 'Buyurtma {raqam}' },
      });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('MESSAGE_TEMPLATE_INVALID');

      try {
        const ok = await marketer.send(
          'patch',
          '/v1/admin/messaging/templates/cart_abandoned_2h',
          body,
        );
        expect(ok.status).toBe(200);
        expect(ok.body).toMatchObject({ delayMin: 90, body: body.body });
        app.get(SettingsService).invalidate();
        expect((await app.get(SettingsService).get('messaging.rules')).abandonedCartMinutes).toBe(
          90,
        );
        const audit = await prisma.auditLog.findFirst({
          where: { staffId, action: 'message_template.update', entityId: 'cart_abandoned_2h' },
        });
        expect(audit).not.toBeNull();
      } finally {
        await prisma.messageTemplate.update({
          where: { key: 'cart_abandoned_2h' },
          data: {
            body: original.body as object,
            buttons: original.buttons as object,
            delayMin: original.delayMin,
          },
        });
      }
    });

    it('test to myself: SMS to the staff phone for an approved text, audited', async () => {
      const noPhone = await marketer.post('/v1/admin/messaging/templates/order_created/test', {
        locale: 'uz',
      });
      expect(noPhone.body.error.code).toBe('MESSAGE_TEST_NO_CONTACT');
      const own = phone();
      await prisma.staff.update({ where: { id: staffId }, data: { phone: own } });
      const res = await marketer.post('/v1/admin/messaging/templates/order_created/test', {
        locale: 'uz',
      });
      expect(res.status).toBe(201);
      expect(res.body.channel).toBe('SMS');
      const sms = integrations.outbox.list(own);
      expect(sms).toHaveLength(1);
      // Exactly the approved text with example values: no prefix, no extra lines (Eskiz).
      expect(sms[0]!.text).toBe(
        'Forest: buyurtma F-10001 qabul qilindi. Kuzatish: https://forest.uz',
      );
      const unapproved = await marketer.post(
        '/v1/admin/messaging/templates/cart_abandoned_2h/test',
        {
          locale: 'uz',
        },
      );
      expect(unapproved.body.error.code).toBe('MESSAGE_TEST_SMS_NOT_APPROVED');
      expect(
        await prisma.auditLog.count({ where: { staffId, action: 'message_template.test' } }),
      ).toBe(1);
    });

    it('custom audience templates: create, refuse delete while an audience uses it, delete', async () => {
      const key = `custom_t${run}_adm`;
      const tpl = {
        key,
        body: {
          uz: '{ism}, yangi kolleksiya: {link} Rad etish: {stop}',
          ru: '{ism}, новая коллекция: {link} Отписаться: {stop}',
        },
        buttons: [],
        delayMin: 0,
        smsFallback: true,
        smsApproved: false,
        active: true,
      };
      const noStop = await marketer.post('/v1/admin/messaging/templates', {
        ...tpl,
        body: { uz: '{ism}: {link}', ru: '{ism}: {link} {stop}' },
      });
      expect(noStop.body.error.code).toBe('MESSAGE_TEMPLATE_INVALID');
      expect(noStop.body.error.field).toBe('body.uz');
      const created = await marketer.post('/v1/admin/messaging/templates', tpl);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        key,
        kind: 'marketing',
        custom: true,
        vars: ['ism', 'link', 'stop'],
      });
      expect((await marketer.post('/v1/admin/messaging/templates', tpl)).body.error.code).toBe(
        'MESSAGE_TEMPLATE_EXISTS',
      );
      const seg = await prisma.segment.create({
        data: {
          name: `uses ${key}`,
          rules: { groups: [] },
          active: false,
          autoMessage: {
            enabled: true,
            steps: [{ channel: 'sms', delayMinutes: 0, templateKey: key }],
          },
          destinations: [],
        },
      });
      segmentIds.push(seg.id);
      const inUse = await marketer.send('delete', `/v1/admin/messaging/templates/${key}`);
      expect(inUse.body.error.code).toBe('MESSAGE_TEMPLATE_IN_USE');
      await prisma.segment.update({ where: { id: seg.id }, data: { autoMessage: Prisma.DbNull } });
      expect((await marketer.send('delete', `/v1/admin/messaging/templates/${key}`)).status).toBe(
        204,
      );
      expect(
        (await marketer.send('delete', '/v1/admin/messaging/templates/order_created')).status,
      ).toBe(404);
    });

    it('a changed SMS text loses its Eskiz approval unless the request re-approves it', async () => {
      const key = `custom_t${run}_appr`;
      const body = {
        uz: 'Yangi: {link} Rad etish: {stop}',
        ru: 'Новое: {link} Отписаться: {stop}',
      };
      const base = { buttons: [], delayMin: 0, smsFallback: true, active: true };
      expect(
        (
          await marketer.post('/v1/admin/messaging/templates', {
            key,
            body,
            ...base,
            smsApproved: true,
          })
        ).body.smsApproved,
      ).toBe(true);
      const path = `/v1/admin/messaging/templates/${key}`;
      const edited = { uz: `${body.uz} !`, ru: body.ru };
      // Ticked approval sent along with a new text, but no explicit re-approval → stored false.
      const lost = await marketer.send('patch', path, { body: edited, ...base, smsApproved: true });
      expect(lost.body.smsApproved).toBe(false);
      // Same text: the flag is stored as sent.
      const kept = await marketer.send('patch', path, { body: edited, ...base, smsApproved: true });
      expect(kept.body.smsApproved).toBe(true);
      const again = { uz: `${body.uz} !!`, ru: body.ru };
      const reapproved = await marketer.send('patch', path, {
        body: again,
        ...base,
        smsApproved: true,
        smsReapproved: true,
      });
      expect(reapproved.body.smsApproved).toBe(true);
      expect((await marketer.send('delete', path)).status).toBe(204);
    });

    it('a marketing SMS without the {stop} slot is never sent', async () => {
      const key = `custom_t${run}_nostop`;
      await prisma.messageTemplate.create({
        data: { key, body: { uz: 'Aksiya: {link}', ru: 'Акция: {link}' }, smsApproved: true },
      });
      const c = await customer({ sms: true });
      await dispatcher.enqueue({
        templateKey: key,
        kind: 'marketing',
        customerId: c.id,
        channels: ['SMS'],
        vars: { link: 'https://forest.test' },
        now: base,
      });
      expect((await messages(c.id))[0]).toMatchObject({
        status: 'SKIPPED',
        error: 'no opt-out slot',
      });
      expect(integrations.outbox.list(c.phone!)).toHaveLength(0);
    });

    it('settings bounds: quiet hours stay ≥ 8 h over the night; cap > 2 is owner-only', async () => {
      const got = await marketer.get('/v1/admin/messaging/settings');
      const { abandonedCartMinutes: _a, reviewRequestDays: _r, ...value } = got.body.value;
      const put = (client: AdminClient, patch: object) =>
        client.send('put', '/v1/admin/messaging/settings', {
          ...value,
          version: got.body.version,
          ...patch,
        });
      for (const patch of [
        { quietStart: '09:00', quietEnd: '09:00' },
        { quietStart: '23:00', quietEnd: '06:00' },
        { quietStart: '22:00', quietEnd: '10:00' },
        { marketingPerDay: 3 },
      ]) {
        const res = await put(marketer, patch);
        expect(res.body.error?.code, JSON.stringify(patch)).toBe('MESSAGING_SETTINGS_UNSAFE');
      }
      const owner = (await signedIn(app, 'OWNER')).client;
      expect((await put(owner, { marketingPerDay: 6 })).status).toBe(400);
      const ok = await put(owner, { marketingPerDay: 4, quietStart: '22:00', quietEnd: '08:00' });
      expect(ok.status).toBe(200);
      expect(ok.body.value).toMatchObject({ marketingPerDay: 4, quietStart: '22:00' });
      await prisma.setting.update({
        where: { key: 'messaging.rules' },
        data: { value: savedRules as object },
      });
    });

    it('settings: version check, cap and scenario switches; operators must hold bot.inbox', async () => {
      const got = await marketer.get('/v1/admin/messaging/settings');
      expect(got.status).toBe(200);
      const { abandonedCartMinutes: _a, reviewRequestDays: _r, ...value } = got.body.value;
      const next = {
        ...value,
        version: got.body.version,
        marketingPerDay: 2,
        scenarios: { ...value.scenarios, waitlist: false },
      };
      const saved = await marketer.send('put', '/v1/admin/messaging/settings', next);
      expect(saved.status).toBe(200);
      expect(saved.body.value).toMatchObject({
        marketingPerDay: 2,
        scenarios: { waitlist: false },
      });
      const stale = await marketer.send('put', '/v1/admin/messaging/settings', next);
      expect(stale.body.error.code).toBe('SETTINGS_CONFLICT');
      const notOperator = await marketer.send('put', '/v1/admin/messaging/settings', {
        ...next,
        version: saved.body.version,
        operatorIds: [staffId],
      });
      expect(notOperator.status).toBe(400);
    });
  });
});
