import { randomBytes } from 'node:crypto';
import { isOperatorHours, type StaffRole } from '@forest/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Update } from 'grammy/types';
import request from 'supertest';
import { BotService, BotUnreachableError } from '../src/bot/bot.service';
import { CartLinkService } from '../src/bot/cart-link.service';
import { fakeUpdates, type FakeTelegramTransport } from '../src/bot/fake-telegram';
import { TelegramGateway } from '../src/bot/telegram-gateway.service';
import { ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env';
import { FilesService } from '../src/files/files.service';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/settings/settings.service';
import { nextTestIp } from './app';
import { type AdminClient, createAdminTestApp, createStaff, signedIn } from './admin-helpers';

/** Object storage in memory: bot photos are downloaded and stored privately. */
class MemoryFiles extends FilesService {
  readonly objects = new Map<string, { body: Buffer; public: boolean }>();
  override async put(key: string, body: Buffer, _type: string, isPublic: boolean) {
    this.objects.set(`${isPublic ? 'pub' : 'priv'}:${key}`, { body, public: isPublic });
  }
  override async getPrivate(key: string) {
    const o = this.objects.get(`priv:${key}`);
    return o ? { body: o.body, metadata: {} } : null;
  }
  override async remove(key: string, isPublic: boolean) {
    this.objects.delete(`${isPublic ? 'pub' : 'priv'}:${key}`);
  }
  override async signedGetUrl(key: string) {
    return `http://signed.test/${key}?sig=1`;
  }
}

/** Smallest valid JPEG header our magic-byte check accepts (SOI + SOF0 with 4×3). */
function jpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x03, 0x00, 0x04, 0x03, 0x01, 0x22, 0x00, 0x02,
    0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
  ]);
}

const run = Date.now().toString(36);
const chatBase = 7_000_000_000 + Math.floor(Math.random() * 100_000_000);
let chatSeq = 0;
const nextChat = () => chatBase + ++chatSeq * 13;
const phoneBase = Math.floor(Math.random() * 9_000_000);
let phoneSeq = 0;
const nextPhone = () => `+99894${String((phoneBase + ++phoneSeq) % 10_000_000).padStart(7, '0')}`;

describe('Telegram bot flows 1–5 with the fake transport (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let integrations: IntegrationsService;
  let fake: FakeTelegramTransport;
  let bot: BotService;
  let secret: string;
  let ownerId: string;
  let files: MemoryFiles;
  const chats: number[] = [];
  const customerIds: string[] = [];
  const adminChat = String(-1_000_000_000_000 - Math.floor(Math.random() * 1000));
  let botRulesBefore: unknown;
  let messagingRulesBefore: unknown;

  const http = () => request(app.getHttpServer());

  function post(update: Update, opts: { header?: string; path?: string } = {}) {
    return http()
      .post(`/v1/webhooks/telegram/${opts.path ?? secret}`)
      .set('X-Telegram-Bot-Api-Secret-Token', opts.header ?? secret)
      .send(update);
  }

  function chat(): number {
    const id = nextChat();
    chats.push(id);
    return id;
  }

  const textsTo = (chatId: number) =>
    fake.sent(chatId).map((c) => String(c.payload.text ?? c.payload.caption ?? ''));
  const lastTo = (chatId: number) => fake.sent(chatId).at(-1)!;
  const markupOf = (c: { payload: Record<string, unknown> }) =>
    c.payload.reply_markup as {
      inline_keyboard?: {
        text: string;
        url?: string;
        callback_data?: string;
        copy_text?: { text: string };
      }[][];
      keyboard?: { text: string; request_contact?: boolean }[][];
    };

  /** /start + own contact → a linked customer. */
  async function linkedCustomer(): Promise<{ chatId: number; customerId: string; phone: string }> {
    const chatId = chat();
    const phone = nextPhone();
    await post(fakeUpdates.text(chatId, '/start')).expect(200);
    await post(fakeUpdates.contact(chatId, phone.slice(1))).expect(200);
    const c = await prisma.customer.findUniqueOrThrow({ where: { phone } });
    customerIds.push(c.id);
    return { chatId, customerId: c.id, phone };
  }

  async function deliveredOrder(customerId: string, phone: string) {
    const variant = await prisma.variant.findUniqueOrThrow({
      where: { sku: 'FR-CW-1000' },
      include: { product: true },
    });
    return prisma.order.create({
      data: {
        publicId: `bot-${run}-${randomBytes(4).toString('hex')}`,
        trackingToken: `bt${randomBytes(5).toString('hex')}`,
        customerId,
        status: 'DELIVERED',
        contactName: 'Dilnoza',
        contactPhone: phone,
        address: { region: 'tashkent', line: '—' },
        subtotalTiyin: variant.priceTiyin,
        totalTiyin: variant.priceTiyin,
        paymentMethod: 'COD',
        deliveryZone: 'tashkent',
        carrier: 'YANDEX',
        offerVersion: '1',
        items: {
          create: {
            variantId: variant.id,
            sellerId: variant.product.sellerId,
            nameSnapshot: { product: variant.product.name, variant: variant.label },
            sku: variant.sku,
            ikpu: '03209001001000000',
            vatPercent: 12,
            qty: 2,
            priceTiyin: variant.priceTiyin,
          },
        },
      },
    });
  }

  beforeAll(async () => {
    app = await createAdminTestApp([], {}, (b) =>
      b
        .overrideProvider(FilesService)
        .useFactory({ factory: (env: Env) => new MemoryFiles(env), inject: [ENV] }),
    );
    prisma = app.get(PrismaService);
    integrations = app.get(IntegrationsService);
    files = app.get(FilesService) as MemoryFiles;
    fake = app.get(TelegramGateway).fake;
    bot = app.get(BotService);
    ownerId = (await createStaff(prisma, 'OWNER')).id;
    botRulesBefore = (await prisma.setting.findUniqueOrThrow({ where: { key: 'bot.rules' } }))
      .value;
    messagingRulesBefore = (
      await prisma.setting.findUniqueOrThrow({ where: { key: 'messaging.rules' } })
    ).value;
    const health = await integrations.connect(
      'telegram',
      {
        botToken: `7000000002:${randomBytes(18).toString('base64url')}`,
        botUsername: 'forest_test_bot',
        adminChatId: adminChat,
      },
      ownerId,
      null,
    );
    expect(health.ok).toBe(true);
    secret = (await integrations.credentials('telegram')).webhookSecret!;
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  afterAll(async () => {
    const ids = chats.map((c) => BigInt(c));
    const convs = await prisma.conversation.findMany({ where: { telegramChatId: { in: ids } } });
    const fileIds = (
      await prisma.conversationMessage.findMany({
        where: { conversationId: { in: convs.map((c) => c.id) } },
      })
    ).flatMap((m) => m.fileIds);
    await prisma.conversation.deleteMany({ where: { telegramChatId: { in: ids } } });
    const reviews = await prisma.review.findMany({ where: { customerId: { in: customerIds } } });
    await prisma.review.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.file.deleteMany({
      where: { id: { in: [...fileIds, ...reviews.flatMap((r) => r.photoFileIds)] } },
    });
    await prisma.order.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.cart.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.message.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.consent.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.visitor.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.botSubscriber.deleteMany({ where: { telegramId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.setting.update({
      where: { key: 'bot.rules' },
      data: { value: botRulesBefore as object },
    });
    await prisma.setting.update({
      where: { key: 'messaging.rules' },
      data: { value: messagingRulesBefore as object },
    });
    // Shared DB: the other suites expect the telegram integration disconnected.
    await integrations.disconnect('telegram', ownerId, null);
    await app.close();
  });

  describe('webhook', () => {
    it('accepts only the secret path + matching secret_token header', async () => {
      const chatId = chat();
      await post(fakeUpdates.text(chatId, 'salom'), { path: 'x'.repeat(43) }).expect(404);
      await post(fakeUpdates.text(chatId, 'salom'), { header: 'wrong' }).expect(404);
      await http()
        .post(`/v1/webhooks/telegram/${secret}`)
        .send(fakeUpdates.text(chatId, 'salom'))
        .expect(404);
      await post(fakeUpdates.text(chatId, 'salom')).expect(200);
    });

    it('handles a redelivered update once', async () => {
      const chatId = chat();
      const update = fakeUpdates.text(chatId, '/yordam');
      await post(update).expect(200);
      await post(update).expect(200);
      expect(fake.sent(chatId)).toHaveLength(1);
    });
  });

  describe('flow 1: lead + SALOM10 + phone', () => {
    it('start link → welcome with the code, phone request → lead in CRM, visitor stitched', async () => {
      const aid = randomBytes(18).toString('base64url');
      const link = await http()
        .post('/v1/bot/start-link')
        .set('X-Forwarded-For', nextTestIp())
        .set('Cookie', `fr_aid=${aid}`)
        .send({ src: 'popup' })
        .expect(200);
      const payload = new URL(link.body.url as string).searchParams.get('start')!;
      expect(link.body.url).toContain('https://t.me/forest_test_bot?start=');
      expect(payload.length).toBeLessThanOrEqual(64);

      const chatId = chat();
      await post(fakeUpdates.text(chatId, `/start ${payload}`, { firstName: 'Dilnoza' })).expect(
        200,
      );
      const [welcome, prompt] = fake.sent(chatId);
      expect(String(welcome!.payload.text ?? welcome!.payload.caption)).toContain('SALOM10');
      const inline = markupOf(welcome!).inline_keyboard!.flat();
      expect(inline.find((b) => b.copy_text)?.copy_text?.text).toBe('SALOM10');
      expect(inline.find((b) => b.url)?.url).toContain('utm_medium=bot');
      expect(markupOf(prompt!).keyboard![0]![0]).toMatchObject({ request_contact: true });
      const sub = await prisma.botSubscriber.findUniqueOrThrow({
        where: { telegramId: BigInt(chatId) },
      });
      expect(sub.source).toBe('popup');

      // Someone else's contact is refused.
      await post(fakeUpdates.contact(chatId, '998901112233', chatId + 1)).expect(200);
      expect(textsTo(chatId).at(-1)).toContain("o'z raqamingizni");

      const phone = nextPhone();
      await post(fakeUpdates.contact(chatId, phone.slice(1))).expect(200);
      const customer = await prisma.customer.findUniqueOrThrow({ where: { phone } });
      customerIds.push(customer.id);
      expect(customer.telegramId).toBe(BigInt(chatId));
      expect(customer.leadSource).toBe('bot');
      const consent = await prisma.consent.findFirst({
        where: { customerId: customer.id, channel: 'TELEGRAM' },
        orderBy: { createdAt: 'desc' },
      });
      expect(consent).toMatchObject({ granted: true, source: 'bot' });
      expect(
        (await prisma.botSubscriber.findUniqueOrThrow({ where: { telegramId: BigInt(chatId) } }))
          .phoneSharedAt,
      ).not.toBeNull();
      expect((await prisma.visitor.findUnique({ where: { anonymousId: aid } }))?.customerId).toBe(
        customer.id,
      );
      expect(integrations.outbox.list(phone).some((m) => m.templateKey === 'lead_promo_sms')).toBe(
        true,
      );
      expect(textsTo(chatId).at(-1)).toContain('Rahmat');
      expect(
        await prisma.message.count({
          where: { customerId: customer.id, templateKey: 'lead_welcome' },
        }),
      ).toBe(0); // welcome went before the phone (no customer yet) — recorded without one
    });
  });

  describe('flow 2: order status', () => {
    it('renders items/total and refuses when the scenario is off or the chat blocked', async () => {
      const { chatId, customerId, phone } = await linkedCustomer();
      const order = await deliveredOrder(customerId, phone);
      const r = await bot.sendMessage({
        chatId: String(chatId),
        text: `Forest: buyurtma ${order.number} qabul qilindi.`,
        buttons: [[{ text: 'Kuzatish ↗', url: 'https://forest.test/t/x' }]],
        flow: { kind: 'order', orderId: order.id, templateKey: 'order_created' },
      });
      expect(r.messageId).toMatch(/^\d+$/);
      const text = textsTo(chatId).at(-1)!;
      expect(text).toContain(`Buyurtma ${order.number}`);
      expect(text).toContain('× 2');
      expect(text).toContain('Jami');

      const settings = app.get(SettingsService);
      const rules = await settings.get('bot.rules');
      await settings.set('bot.rules', {
        ...rules,
        scenarios: { ...rules.scenarios, orderStatus: false },
      });
      await expect(
        bot.sendMessage({
          chatId: String(chatId),
          text: 'x',
          flow: { kind: 'order', orderId: order.id, templateKey: 'order_paid' },
        }),
      ).rejects.toMatchObject({ reason: 'scenario_off' });
      await settings.set('bot.rules', rules);

      fake.blocked.add(String(chatId));
      const blocked = await bot
        .sendMessage({ chatId: String(chatId), text: 'x' })
        .catch((e: unknown) => e);
      expect(blocked).toBeInstanceOf(BotUnreachableError);
      expect((blocked as BotUnreachableError).reason).toBe('blocked');
      fake.blocked.delete(String(chatId));
      expect(
        (await prisma.botSubscriber.findUniqueOrThrow({ where: { telegramId: BigInt(chatId) } }))
          .blockedAt,
      ).not.toBeNull();
      // Any update from the chat clears the block.
      await post(fakeUpdates.text(chatId, '/buyurtmalar')).expect(200);
      expect(
        (await prisma.botSubscriber.findUniqueOrThrow({ where: { telegramId: BigInt(chatId) } }))
          .blockedAt,
      ).toBeNull();
      const list = lastTo(chatId);
      expect(String(list.payload.text)).toContain(order.number);
      expect(markupOf(list).inline_keyboard![0]![0]!.url).toContain(`/t/${order.trackingToken}`);
    });

    it('signed order start payload shows that order', async () => {
      const { chatId, customerId, phone } = await linkedCustomer();
      const order = await deliveredOrder(customerId, phone);
      const page = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      const { signDeepLink } = await import('../src/customer/deeplink');
      const token = signDeepLink(
        { kind: 'order', token: page.trackingToken },
        app.get<Env>(ENV).SESSION_SECRET,
      );
      await post(fakeUpdates.text(chatId, `/start ${token}`)).expect(200);
      expect(fake.sent(chatId).some((c) => String(c.payload.text).includes(order.number))).toBe(
        true,
      );
    });
  });

  describe('flow 3: abandoned cart + restore link', () => {
    it('photo, summary, finish/question/opt-out buttons; the link restores the cart', async () => {
      const { chatId, customerId } = await linkedCustomer();
      const variant = await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-CW-1000' } });
      const cart = await prisma.cart.create({
        data: { customerId, items: { create: { variantId: variant.id, qty: 3 } } },
      });
      const link = app
        .get(CartLinkService)
        .restoreUrl({ cartId: cart.id, promo: 'SAVAT5', campaign: 'abandoned_cart' });
      await bot.sendMessage({
        chatId: String(chatId),
        text: 'Dilnoza, savatingizda qoldi: Chalk White. Bugun SAVAT5 kodi bilan −5%.',
        buttons: [
          [{ text: 'Buyurtmani yakunlash ↗', url: link }],
          [{ text: "Eslatmani o'chirish", callbackData: 'mk:stop' }],
        ],
        flow: { kind: 'abandoned_cart', cartId: cart.id },
      });
      const msg = lastTo(chatId);
      expect(String(msg.payload.text ?? msg.payload.caption)).toContain('Savatda: 3 ta mahsulot');
      const buttons = markupOf(msg).inline_keyboard!.flat();
      expect(buttons.map((b) => b.callback_data).filter(Boolean)).toEqual(['ask:cart', 'mk:stop']);
      expect(buttons[0]!.url).toBe(link);

      // Another browser opens the link: the lines are copied into its own cart (twice = same qty).
      const browser = request.agent(app.getHttpServer()).set('X-Forwarded-For', nextTestIp());
      const token = link.split('/c/')[1]!;
      const res = await browser.post('/v1/cart/restore').send({ token }).expect(200);
      expect(res.body.restored).toBe(1);
      await browser.post('/v1/cart/restore').send({ token }).expect(200);
      const shopCart = await browser.get('/v1/cart').expect(200);
      expect(shopCart.body.lines.map((l: { qty: number }) => l.qty)).toEqual([3]);
      expect(shopCart.body.promo.code).toBe('SAVAT5');
      expect(shopCart.body.id).not.toBe(cart.id); // a copy, never the customer's cart row
      await prisma.cart.delete({ where: { id: shopCart.body.id as string } });
      await browser
        .post('/v1/cart/restore')
        .send({ token: `${token.slice(0, -2)}xx` })
        .expect(400);

      // "Savolim bor" → the next text goes to the inbox as a cart question.
      await post(fakeUpdates.callback(chatId, 'ask:cart')).expect(200);
      await post(fakeUpdates.text(chatId, 'Zaytun velurga chiqadimi?')).expect(200);
      const conv = await prisma.conversation.findFirstOrThrow({
        where: { telegramChatId: BigInt(chatId) },
      });
      expect(conv.topic).toBe('cart');

      // Opt-out button: TELEGRAM marketing consent revoked.
      await post(fakeUpdates.callback(chatId, 'mk:stop')).expect(200);
      const consent = await prisma.consent.findFirst({
        where: { customerId, channel: 'TELEGRAM' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      expect(consent?.granted).toBe(false);
      expect(textsTo(chatId).at(-1)).toContain("Eslatmalar o'chirildi");
    });
  });

  describe('flow 4: color advice + inbox', () => {
    it('photo → private file, NEW conversation, one auto-reply; complaint → alert', async () => {
      const { chatId, customerId } = await linkedCustomer();
      fake.addFile(`ph-${chatId}`, jpeg());
      await post(fakeUpdates.photo(chatId, `ph-${chatId}`, 'Shu kresloga qaysi rang mos?')).expect(
        200,
      );
      const conv = await prisma.conversation.findFirstOrThrow({
        where: { telegramChatId: BigInt(chatId) },
        include: { messages: true },
      });
      expect(conv).toMatchObject({ status: 'NEW', topic: 'advice', customerId });
      const file = await prisma.file.findUniqueOrThrow({
        where: { id: conv.messages[0]!.fileIds[0]! },
      });
      expect(file.isPublic).toBe(false);
      expect(files.objects.has(`priv:${file.key}`)).toBe(true);
      const hours = await app.get(SettingsService).get('messaging.rules');
      const expected = isOperatorHours(hours, new Date()) ? 'mutaxassisimiz' : '9:00';
      expect(textsTo(chatId).at(-1)!.toLowerCase()).toContain(expected.toLowerCase());
      const before = fake.sent(chatId).length;
      await post(fakeUpdates.text(chatId, 'Yana bir savol')).expect(200);
      expect(fake.sent(chatId).length).toBe(before); // no second auto-reply

      const alertsBefore = fake.sent(adminChat).length;
      await post(fakeUpdates.text(chatId, 'Bu shikoyat: rang yomon chiqdi')).expect(200);
      const after = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
      expect(after.status).toBe('COMPLAINT');
      expect(fake.sent(adminChat).length).toBe(alertsBefore + 1);
      expect(String(lastTo(Number(adminChat)).payload.text)).toContain('Shikoyat');
    });
  });

  describe('flow 5: review + photo', () => {
    it('stars → review, photo → RAHMAT5 + consent; ≤3★ → apology + complaint + alert', async () => {
      const { chatId, customerId, phone } = await linkedCustomer();
      const order = await deliveredOrder(customerId, phone);
      await bot.sendMessage({
        chatId: String(chatId),
        text: 'Dilnoza, natija qanday chiqdi? Baholang:',
        flow: { kind: 'review_request', orderId: order.id },
      });
      const stars = markupOf(lastTo(chatId)).inline_keyboard![0]!.map((b) => b.callback_data);
      expect(stars).toEqual([1, 2, 3, 4, 5].map((n) => `rv:${order.id}:${n}`));

      // A stranger can't rate someone else's order.
      const stranger = chat();
      await post(fakeUpdates.callback(stranger, `rv:${order.id}:1`)).expect(200);
      expect(await prisma.review.count({ where: { orderId: order.id } })).toBe(0);

      await post(fakeUpdates.callback(chatId, `rv:${order.id}:5`)).expect(200);
      const review = await prisma.review.findFirstOrThrow({ where: { orderId: order.id } });
      expect(review).toMatchObject({ rating: 5, source: 'bot', status: 'PENDING', customerId });
      expect(textsTo(chatId).at(-1)).toContain('fotosini yuboring');

      fake.addFile(`rv-${chatId}`, jpeg());
      await post(fakeUpdates.photo(chatId, `rv-${chatId}`)).expect(200);
      const withPhoto = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
      expect(withPhoto.photoFileIds).toHaveLength(1);
      const codeMsg = lastTo(chatId);
      expect(String(codeMsg.payload.text)).toContain('RAHMAT5');
      expect(markupOf(codeMsg).inline_keyboard![0]!.map((b) => b.callback_data)).toEqual([
        `rc:${review.id}:1`,
        `rc:${review.id}:0`,
      ]);
      await post(fakeUpdates.text(chatId, 'Divan yangidek bo‘ldi!')).expect(200);
      await post(fakeUpdates.callback(chatId, `rc:${review.id}:1`)).expect(200);
      const done = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
      expect(done.photoConsent).toBe(true);
      expect(done.text).toContain('yangidek');
      const photo = await prisma.file.findUniqueOrThrow({ where: { id: done.photoFileIds[0]! } });
      expect(photo.isPublic).toBe(false); // public only after moderation

      // Second order, low rating.
      const second = await deliveredOrder(customerId, phone);
      const alerts = fake.sent(adminChat).length;
      await post(fakeUpdates.callback(chatId, `rv:${second.id}:2`)).expect(200);
      expect(textsTo(chatId).at(-1)).toContain('Kechirasiz');
      expect(fake.sent(adminChat).length).toBe(alerts + 1);
      const conv = await prisma.conversation.findFirstOrThrow({
        where: { telegramChatId: BigInt(chatId), topic: 'review' },
      });
      expect(conv.status).toBe('COMPLAINT');
      // Rating twice = already rated.
      await post(fakeUpdates.callback(chatId, `rv:${second.id}:4`)).expect(200);
      expect(textsTo(chatId).at(-1)).toContain('allaqachon');
    });
  });

  describe('commands', () => {
    it('/til switches language (customer too), /stop revokes marketing, /yordam shows hours', async () => {
      const { chatId, customerId } = await linkedCustomer();
      await post(fakeUpdates.text(chatId, '/til')).expect(200);
      await post(fakeUpdates.callback(chatId, 'lang:ru')).expect(200);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).locale).toBe(
        'ru',
      );
      expect(textsTo(chatId).at(-1)).toContain('русский');
      await post(fakeUpdates.text(chatId, '/yordam')).expect(200);
      expect(textsTo(chatId).at(-1)).toContain('Часы работы');
      await post(fakeUpdates.text(chatId, '/stop')).expect(200);
      const consent = await prisma.consent.findFirst({
        where: { customerId, channel: 'TELEGRAM' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      expect(consent?.granted).toBe(false);
      const sub = await prisma.botSubscriber.findUniqueOrThrow({
        where: { telegramId: BigInt(chatId) },
      });
      expect(sub.stoppedAt).not.toBeNull();
      // /start again re-enables marketing (explicit action).
      await post(fakeUpdates.text(chatId, '/start')).expect(200);
      const again = await prisma.consent.findFirst({
        where: { customerId, channel: 'TELEGRAM' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      expect(again?.granted).toBe(true);
    });

    it('/start of an already linked chat opts in to reminders once (q.90)', async () => {
      const chatId = chat();
      const c = await prisma.customer.create({
        data: { telegramId: BigInt(chatId), name: 'Aziz', leadSource: 'telegram_login' },
      });
      customerIds.push(c.id);
      await post(fakeUpdates.text(chatId, '/start')).expect(200);
      const rows = await prisma.consent.findMany({
        where: { customerId: c.id, channel: 'TELEGRAM' },
      });
      expect(rows.map((r) => [r.granted, r.source])).toEqual([[true, 'bot']]);
      await post(fakeUpdates.text(chatId, '/start')).expect(200);
      expect(await prisma.consent.count({ where: { customerId: c.id, channel: 'TELEGRAM' } })).toBe(
        1,
      );
    });

    it('blocking the bot (my_chat_member) marks the subscriber', async () => {
      const chatId = chat();
      await post(fakeUpdates.text(chatId, '/start')).expect(200);
      await post(fakeUpdates.blocked(chatId)).expect(200);
      const sub = await prisma.botSubscriber.findUniqueOrThrow({
        where: { telegramId: BigInt(chatId) },
      });
      expect(sub.blockedAt).not.toBeNull();
    });
  });

  describe('admin A12', () => {
    const clients = new Map<StaffRole, AdminClient>();

    beforeAll(async () => {
      for (const role of ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE', 'MARKETER'] as StaffRole[])
        clients.set(role, (await signedIn(app, role)).client);
    });

    const table: [StaffRole, number, number][] = [
      ['OWNER', 200, 200],
      ['MANAGER', 200, 200],
      ['MARKETER', 200, 403],
      ['OPERATOR', 403, 200],
      ['WAREHOUSE', 403, 403],
    ];
    for (const [role, edit, inbox] of table) {
      it(`${role}: overview ${edit}, inbox ${inbox}`, async () => {
        const c = clients.get(role)!;
        expect((await c.get('/v1/admin/bot/overview')).status).toBe(edit);
        expect((await c.get('/v1/admin/bot/conversations')).status).toBe(inbox);
        expect(
          (await c.send('patch', '/v1/admin/bot/conversations/nope', { status: 'CLOSED' })).status,
        ).toBe(inbox === 200 ? 404 : 403);
        expect(
          (await c.send('put', '/v1/admin/bot/scenarios', { scenario: 'advice', enabled: true }))
            .status,
        ).toBe(edit);
      });
    }

    it('operator replies with text and a product card, closes; audited without the text', async () => {
      const { chatId } = await linkedCustomer();
      await post(fakeUpdates.text(chatId, 'Qaysi rang yaxshi?')).expect(200);
      const op = clients.get('OPERATOR')!;
      const list = await op.get('/v1/admin/bot/conversations?status=NEW');
      const row = list.body.items.find(
        (i: { title: string; id: string; preview: string }) => i.preview === 'Qaysi rang yaxshi?',
      );
      expect(row).toBeDefined();
      expect(list.body.counts.NEW).toBeGreaterThanOrEqual(1);
      const variant = await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-CW-1000' } });
      const res = await op.post(`/v1/admin/bot/conversations/${row.id}/reply`, {
        text: 'Zaytun yoki Antrasit mos keladi.',
        product: { variantId: variant.id, qty: 1 },
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ANSWERED');
      expect(res.body.messages.at(-1).product.name).toBeTruthy();
      const sent = fake.sent(chatId).slice(-2);
      expect(String(sent[0]!.payload.text)).toContain('Forest mutaxassisi');
      expect(markupOf(sent[1]!).inline_keyboard![0]![0]!.url).toMatch(/\/c\/[\w-]+\.[\w-]+$/);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'bot.conversation.reply', entityId: row.id },
      });
      expect(JSON.stringify(audit.after)).not.toContain('Antrasit');

      const closed = await op.send('patch', `/v1/admin/bot/conversations/${row.id}`, {
        status: 'CLOSED',
      });
      expect(closed.body.status).toBe('CLOSED');
      // A new message after closing starts a new conversation.
      await post(fakeUpdates.text(chatId, 'Rahmat!')).expect(200);
      expect(await prisma.conversation.count({ where: { telegramChatId: BigInt(chatId) } })).toBe(
        2,
      );
    });

    it('overview: KPIs from data, scenario switches write both settings', async () => {
      const mk = clients.get('MARKETER')!;
      const o = await mk.get('/v1/admin/bot/overview');
      expect(o.body.kpis.subscribers).toBeGreaterThanOrEqual(3);
      expect(o.body.kpis.phones).toBeGreaterThanOrEqual(3);
      expect(o.body.scenarios.map((s: { key: string }) => s.key)).toEqual([
        'lead',
        'orderStatus',
        'abandonedCart',
        'advice',
        'review',
      ]);
      expect(o.body.settings.tokenMasked).toMatch(/^•••• •••• /);
      let r = await mk.send('put', '/v1/admin/bot/scenarios', {
        scenario: 'abandonedCart',
        enabled: false,
      });
      expect(r.body.scenarios[2].enabled).toBe(false);
      const settings = app.get(SettingsService);
      settings.invalidate();
      expect((await settings.get('messaging.rules')).scenarios.abandonedCart).toBe(false);
      r = await mk.send('put', '/v1/admin/bot/scenarios', {
        scenario: 'abandonedCart',
        enabled: true,
      });
      expect(r.body.scenarios[2].enabled).toBe(true);
      r = await mk.send('put', '/v1/admin/bot/rules', {
        complaintKeywords: ['shikoyat', 'Yomon'],
        version: r.body.version,
      });
      expect(r.body.complaintKeywords).toEqual(['shikoyat', 'yomon']);
      expect(
        (await mk.send('put', '/v1/admin/bot/rules', { complaintKeywords: ['x1'], version: 'old' }))
          .body.error.code,
      ).toBe('SETTINGS_CONFLICT');
    });
  });
});
