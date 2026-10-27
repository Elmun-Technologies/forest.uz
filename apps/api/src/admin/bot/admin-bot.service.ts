import { Injectable } from '@nestjs/common';
import {
  type AdminBotConversationDto,
  type AdminBotConversationListDto,
  type AdminBotConversationRowDto,
  type AdminBotMessageDto,
  type AdminBotOverviewDto,
  type AdminBotScenarioDto,
  type AdminVariantOptionDto,
  BOT_CONVERSATION_STATUSES,
  type BotConversationListQuery,
  type BotConversationPatchInput,
  type BotConversationStatus,
  type BotConversationTopic,
  type BotReplyInput,
  type BotRulesUpdateInput,
  type BotScenario,
  type BotScenarioToggleInput,
  DomainError,
  formatSoum,
  hasPermission,
  type Locale,
  normalizeSearch,
  settingSchemas,
  t,
  tiyinToSoumInt,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { copy, html } from '../../bot/bot-copy';
import { type BotButton, BotService } from '../../bot/bot.service';
import { CartLinkService } from '../../bot/cart-link.service';
import { TelegramGateway } from '../../bot/telegram-gateway.service';
import { FilesService } from '../../files/files.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { maskSecret } from '../../integrations/crypto/secret-box';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { isPurchase, revenueOf } from '../analytics/sql';
import { type AuditActor, AuditService } from '../audit/audit.service';

const DAY_MS = 86_400_000;
/** Orders within this time after a bot touch count as its result (abandoned cart, advice). */
const RESULT_WINDOW = Prisma.raw(`interval '7 days'`);
const ORDER_TEMPLATES = [
  'order_created',
  'order_phone_created',
  'order_paid',
  'order_confirmed',
  'payment_reminder',
  'order_courier',
  'order_shipped',
  'order_shipped_bts',
  'order_at_branch',
  'order_delivered',
  'order_delivery_failed',
  'order_cancelled',
];

type Tx = Prisma.TransactionClient;

function cursorOf(row: { lastMessageAt: Date; id: string }): string {
  return Buffer.from(`${row.lastMessageAt.toISOString()}|${row.id}`).toString('base64url');
}

function parseCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const d = new Date(at ?? '');
  return id && !Number.isNaN(d.getTime()) ? { at: d, id } : null;
}

/** "Dilnoza Yusupova" → "Dilnoza Y." (inbox rows, docs/08 A12). */
export function shortName(name: string | null | undefined): string | null {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return parts.length > 1 ? `${parts[0]} ${parts[1]![0]!.toUpperCase()}.` : parts[0]!;
}

function initials(title: string): string {
  const parts = title.replace('.', '').split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/**
 * A12 bot admin (CLAUDE.md §6, 5A): overview (KPIs + scenarios, `bot.edit`) and the operator
 * inbox (`bot.inbox`). Every mutation writes its audit row in its transaction.
 */
@Injectable()
export class AdminBotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly integrations: IntegrationsService,
    private readonly gateway: TelegramGateway,
    private readonly bot: BotService,
    private readonly links: CartLinkService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  // ───────── overview ─────────

  async overview(now = new Date()): Promise<AdminBotOverviewDto> {
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const [creds, botRules, msgRules, rulesRow] = await Promise.all([
      this.integrations.connectedCredentials('telegram'),
      this.settings.get('bot.rules'),
      this.settings.get('messaging.rules'),
      this.prisma.setting.findUnique({ where: { key: 'bot.rules' }, select: { updatedAt: true } }),
    ]);
    const config = await this.gateway.config();
    const active = { blockedAt: null, stoppedAt: null };
    const [subscribers, newSubs, phones, left30, bot] = await Promise.all([
      this.prisma.botSubscriber.count({ where: active }),
      this.prisma.botSubscriber.count({ where: { ...active, startedAt: { gte: since } } }),
      this.prisma.botSubscriber.count({ where: { ...active, phoneSharedAt: { not: null } } }),
      this.prisma.botSubscriber.count({
        where: { OR: [{ stoppedAt: { gte: since } }, { blockedAt: { gte: since } }] },
      }),
      this.botOrders(since),
    ]);
    const operators = await this.operators(msgRules.operatorIds);
    return {
      botUsername: config?.username ?? null,
      connected: !!creds,
      kpis: {
        subscribers,
        subscribersNew30d: newSubs,
        phones,
        phonesPct: subscribers ? Math.round((phones * 100) / subscribers) : null,
        botOrders30d: bot.orders,
        botRevenueSoum30d: tiyinToSoumInt(bot.revenue),
        unsubscribeRatePct:
          subscribers + left30 ? Math.round((left30 * 1000) / (subscribers + left30)) / 10 : null,
      },
      scenarios: await this.scenarios(since, botRules.scenarios, msgRules.scenarios),
      complaintKeywords: botRules.complaintKeywords,
      settings: {
        operatorDays: msgRules.operatorDays,
        operatorStart: msgRules.operatorStart,
        operatorEnd: msgRules.operatorEnd,
        marketingPerDay: msgRules.marketingPerDay,
        languages: msgRules.languages,
        operators,
        tokenMasked: creds?.botToken ? maskSecret(creds.botToken) : null,
        adminGroup: !!creds?.adminChatId,
      },
      version: rulesRow?.updatedAt.toISOString() ?? null,
    };
  }

  /** Purchases whose purchasing session came from a bot link (`utm_medium=bot`). */
  private async botOrders(since: Date): Promise<{ orders: number; revenue: bigint }> {
    const [row] = await this.prisma.$queryRaw<{ n: bigint; revenue: bigint | null }[]>`
      SELECT COUNT(*)::bigint AS n, SUM(${revenueOf('o')})::bigint AS revenue
      FROM "Order" o JOIN "Session" s ON s.id = o."sessionId"
      WHERE o."createdAt" >= ${since} AND lower(s.utm->>'medium') = 'bot' AND ${isPurchase('o')}`;
    return { orders: Number(row?.n ?? 0), revenue: row?.revenue ?? 0n };
  }

  private async sent(keys: string[], since: Date): Promise<number> {
    return this.prisma.message.count({
      where: {
        channel: 'TELEGRAM',
        templateKey: { in: keys },
        status: { in: ['SENT', 'DELIVERED'] },
        createdAt: { gte: since },
      },
    });
  }

  /** Purchases created within 7 days after one of these Telegram messages to the customer. */
  private async ordersAfterMessages(keys: string[], since: Date): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT o.id)::bigint AS n FROM "Order" o
      WHERE ${isPurchase('o')} AND EXISTS (
        SELECT 1 FROM "Message" m WHERE m."customerId" = o."customerId" AND m.channel = 'TELEGRAM'
          AND m."templateKey" IN (${Prisma.join(keys)}) AND m.status IN ('SENT', 'DELIVERED')
          AND m."createdAt" >= ${since} AND o."createdAt" > m."createdAt"
          AND o."createdAt" <= m."createdAt" + ${RESULT_WINDOW})`;
    return Number(row?.n ?? 0);
  }

  /** Purchases within 7 days after the customer wrote to the inbox (advice → order). */
  private async ordersAfterAdvice(since: Date): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT o.id)::bigint AS n FROM "Order" o
      WHERE ${isPurchase('o')} AND EXISTS (
        SELECT 1 FROM "Conversation" c JOIN "ConversationMessage" m ON m."conversationId" = c.id
        WHERE c."customerId" = o."customerId" AND m."fromCustomer" = true
          AND m."createdAt" >= ${since} AND o."createdAt" > m."createdAt"
          AND o."createdAt" <= m."createdAt" + ${RESULT_WINDOW})`;
    return Number(row?.n ?? 0);
  }

  private async scenarios(
    since: Date,
    own: { lead: boolean; orderStatus: boolean; advice: boolean },
    messaging: { abandonedCart: boolean; reviewRequest: boolean },
  ): Promise<AdminBotScenarioDto[]> {
    const [
      leadSent,
      leads,
      orderSent,
      cartSent,
      cartOrders,
      adviceSent,
      adviceOrders,
      reviewSent,
      reviews,
    ] = await Promise.all([
      this.sent(['lead_welcome'], since),
      this.prisma.botSubscriber.count({ where: { phoneSharedAt: { gte: since } } }),
      this.sent(ORDER_TEMPLATES, since),
      this.sent(['cart_abandoned_2h'], since),
      this.ordersAfterMessages(['cart_abandoned_2h'], since),
      this.sent(['advice_received', 'advice_off_hours'], since),
      this.ordersAfterAdvice(since),
      this.sent(['review_request'], since),
      this.prisma.review.count({ where: { source: 'bot', createdAt: { gte: since } } }),
    ]);
    const row = (
      key: BotScenario,
      enabled: boolean,
      sent30d: number,
      result30d: number | null,
      resultKind: AdminBotScenarioDto['resultKind'],
    ): AdminBotScenarioDto => ({ key, enabled, sent30d, result30d, resultKind });
    return [
      row('lead', own.lead, leadSent, leads, 'leads'),
      row('orderStatus', own.orderStatus, orderSent, null, null),
      row('abandonedCart', messaging.abandonedCart, cartSent, cartOrders, 'orders'),
      row('advice', own.advice, adviceSent, adviceOrders, 'orders'),
      row('review', messaging.reviewRequest, reviewSent, reviews, 'reviews'),
    ];
  }

  /** `messaging.rules.operatorIds`, else every active Operator. */
  private async operators(ids: string[]): Promise<{ id: string; name: string }[]> {
    const staff = await this.prisma.staff.findMany({
      where: ids.length ? { id: { in: ids }, active: true } : { role: 'OPERATOR', active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return staff;
  }

  /**
   * One A12 switch. Lead/order status/advice live in `bot.rules`; abandoned cart and review
   * request are the messaging engine's (`messaging.rules.scenarios`, 5B) — partial update under
   * the row lock, so a concurrent full save of that document sees the new version.
   */
  async toggleScenario(actor: AuditActor, input: BotScenarioToggleInput): Promise<void> {
    const own =
      input.scenario === 'lead' || input.scenario === 'orderStatus' || input.scenario === 'advice';
    const key = own ? 'bot.rules' : 'messaging.rules';
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "key" FROM "Setting" WHERE "key" = ${key} FOR UPDATE`;
      const row = await tx.setting.findUnique({ where: { key } });
      if (!row) throw new DomainError('NOT_FOUND');
      let value: Prisma.InputJsonValue;
      if (own) {
        const v = settingSchemas['bot.rules'].parse(row.value);
        const field = input.scenario as 'lead' | 'orderStatus' | 'advice';
        value = { ...v, scenarios: { ...v.scenarios, [field]: input.enabled } };
      } else {
        const v = settingSchemas['messaging.rules'].parse(row.value);
        const field = input.scenario === 'abandonedCart' ? 'abandonedCart' : 'reviewRequest';
        value = {
          ...v,
          scenarios: { ...v.scenarios, [field]: input.enabled },
        } as Prisma.InputJsonValue;
      }
      await tx.setting.update({ where: { key }, data: { value, updatedBy: actor.staffId } });
      await this.audit.record(
        actor,
        {
          action: 'settings.bot.scenario',
          entity: 'Setting',
          entityId: key,
          after: { scenario: input.scenario, enabled: input.enabled },
        },
        tx,
      );
    });
    this.settings.invalidate();
  }

  async updateRules(actor: AuditActor, input: BotRulesUpdateInput): Promise<void> {
    const keywords = [...new Set(input.complaintKeywords.map((k) => k.toLowerCase()))];
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "key" FROM "Setting" WHERE "key" = 'bot.rules' FOR UPDATE`;
      const row = await tx.setting.findUnique({ where: { key: 'bot.rules' } });
      if (!row) throw new DomainError('NOT_FOUND');
      if (row.updatedAt.toISOString() !== input.version) throw new DomainError('SETTINGS_CONFLICT');
      const v = settingSchemas['bot.rules'].parse(row.value);
      const next = settingSchemas['bot.rules'].parse({ ...v, complaintKeywords: keywords });
      await tx.setting.update({
        where: { key: 'bot.rules' },
        data: { value: next as Prisma.InputJsonValue, updatedBy: actor.staffId },
      });
      await this.audit.record(
        actor,
        {
          action: 'settings.bot.rules',
          entity: 'Setting',
          entityId: 'bot.rules',
          before: { complaintKeywords: v.complaintKeywords },
          after: { complaintKeywords: keywords },
        },
        tx,
      );
    });
    this.settings.invalidate();
  }

  // ───────── inbox ─────────

  async inboxCount(): Promise<number> {
    return this.prisma.conversation.count({ where: { status: { in: ['NEW', 'COMPLAINT'] } } });
  }

  async list(q: BotConversationListQuery): Promise<AdminBotConversationListDto> {
    const cursor = parseCursor(q.cursor);
    const where: Prisma.ConversationWhereInput = {
      ...(q.status === 'all' ? {} : { status: q.status }),
      ...(cursor
        ? {
            OR: [
              { lastMessageAt: { lt: cursor.at } },
              { lastMessageAt: cursor.at, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
    const [rows, grouped] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
      }),
      this.prisma.conversation.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const page = rows.slice(0, q.limit);
    const counts = Object.fromEntries(
      BOT_CONVERSATION_STATUSES.map((s) => [
        s,
        grouped.find((g) => g.status === s)?._count._all ?? 0,
      ]),
    ) as Record<BotConversationStatus, number>;
    return {
      items: await this.rows(page),
      nextCursor: rows.length > q.limit ? cursorOf(page[page.length - 1]!) : null,
      counts: { all: Object.values(counts).reduce((a, b) => a + b, 0), ...counts },
    };
  }

  private async rows(
    convs: Prisma.ConversationGetPayload<object>[],
  ): Promise<AdminBotConversationRowDto[]> {
    if (!convs.length) return [];
    const ids = convs.map((c) => c.id);
    const customerIds = [
      ...new Set(convs.map((c) => c.customerId).filter((x): x is string => !!x)),
    ];
    const staffIds = [...new Set(convs.map((c) => c.assigneeId).filter((x): x is string => !!x))];
    const chatIds = [...new Set(convs.map((c) => c.telegramChatId))];
    const [last, customers, staff, subs] = await Promise.all([
      this.prisma.$queryRaw<{ conversationId: string; text: string | null; photos: number }[]>`
        SELECT DISTINCT ON ("conversationId") "conversationId", text,
          cardinality("fileIds")::int AS photos
        FROM "ConversationMessage" WHERE "conversationId" IN (${Prisma.join(ids)})
        ORDER BY "conversationId", "createdAt" DESC`,
      this.prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, publicId: true, name: true, deletedAt: true },
      }),
      this.prisma.staff.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, name: true },
      }),
      this.prisma.botSubscriber.findMany({
        where: { telegramId: { in: chatIds } },
        select: { telegramId: true, firstName: true },
      }),
    ]);
    return convs.map((c) => {
      const customer = customers.find((x) => x.id === c.customerId);
      const l = last.find((x) => x.conversationId === c.id);
      const title =
        (customer && !customer.deletedAt ? shortName(customer.name) : null) ??
        shortName(subs.find((s) => s.telegramId === c.telegramChatId)?.firstName) ??
        'Mijoz';
      const assignee = staff.find((s) => s.id === c.assigneeId);
      return {
        id: c.id,
        status: c.status,
        topic: c.topic as BotConversationTopic,
        title,
        initials: initials(title),
        preview: (l?.text ?? (l?.photos ? '[foto]' : '')).slice(0, 140),
        hasPhoto: (l?.photos ?? 0) > 0,
        lastMessageAt: c.lastMessageAt.toISOString(),
        customer:
          customer && !customer.deletedAt ? { id: customer.id, publicId: customer.publicId } : null,
        assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
      };
    });
  }

  async detail(id: string): Promise<AdminBotConversationDto> {
    const conv = await this.prisma.conversation.findUnique({ where: { id } });
    if (!conv) throw new DomainError('BOT_CONVERSATION_NOT_FOUND');
    const [row] = await this.rows([conv]);
    const messages = await this.prisma.conversationMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    messages.reverse();
    const fileIds = [...new Set(messages.flatMap((m) => m.fileIds))];
    const staffIds = [...new Set(messages.map((m) => m.staffId).filter((x): x is string => !!x))];
    const [files, staff, sub, msgRules, config] = await Promise.all([
      this.prisma.file.findMany({ where: { id: { in: fileIds } } }),
      this.prisma.staff.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, name: true },
      }),
      this.prisma.botSubscriber.findUnique({ where: { telegramId: conv.telegramChatId } }),
      this.settings.get('messaging.rules'),
      this.gateway.config(),
    ]);
    // Private photos: 10-minute signed URLs, never public links.
    const urls = new Map(
      await Promise.all(
        files.map(
          async (f) =>
            [
              f.id,
              f.isPublic ? this.files.publicUrl(f.key) : await this.files.signedGetUrl(f.key, 600),
            ] as const,
        ),
      ),
    );
    const dto: AdminBotMessageDto[] = messages.map((m) => {
      const meta = (m.meta ?? {}) as { product?: { name?: string; priceSoum?: number | null } };
      return {
        id: m.id,
        fromCustomer: m.fromCustomer,
        staffName: staff.find((s) => s.id === m.staffId)?.name ?? null,
        text: m.text,
        photos: m.fileIds.flatMap((f) => (urls.has(f) ? [{ fileId: f, url: urls.get(f)! }] : [])),
        product: meta.product?.name
          ? { name: meta.product.name, priceSoum: meta.product.priceSoum ?? null }
          : null,
        createdAt: m.createdAt.toISOString(),
      };
    });
    return {
      ...row!,
      messages: dto,
      operators: await this.operators(msgRules.operatorIds),
      canReply: !!config && conv.telegramChatId !== 0n && !sub?.blockedAt,
    };
  }

  /**
   * Operator reply: each part (text, product card) is one Telegram send followed by its own short
   * transaction (message, status, audit) — never HTTP inside a transaction. When the text went
   * out but the card failed, the text stays recorded and the error says so (`details.sent`), so a
   * retry sends only the card. A reply to a CLOSED conversation lands in the chat's open one if
   * there is one (one open conversation per chat), else reopens it.
   */
  async reply(actor: AuditActor, id: string, input: BotReplyInput, now = new Date()) {
    const asked = await this.prisma.conversation.findUnique({ where: { id } });
    if (!asked) throw new DomainError('BOT_CONVERSATION_NOT_FOUND');
    if (asked.telegramChatId === 0n) throw new DomainError('BOT_SEND_FAILED');
    if (!(await this.gateway.config())) throw new DomainError('BOT_NOT_CONNECTED');
    const conv = (asked.status === 'CLOSED' && (await this.openSibling(asked))) || asked;
    const locale = await this.chatLocale(conv.telegramChatId, conv.customerId);
    const staff = await this.prisma.staff.findUniqueOrThrow({
      where: { id: actor.staffId! },
      select: { name: true },
    });
    const operator = staff.name.split(/\s+/)[0] ?? staff.name;
    const product = input.product ? await this.productCard(input.product.variantId, locale) : null;
    if (input.product && !product) throw new DomainError('PRODUCT_NOT_FOUND');

    const record = (part: 'text' | 'product', meta: Prisma.InputJsonValue) =>
      this.prisma.$transaction(async (tx) => {
        await tx.conversationMessage.create({
          data: {
            conversationId: conv.id,
            fromCustomer: false,
            staffId: actor.staffId,
            text: part === 'text' ? input.text : null,
            fileIds: [],
            meta,
            createdAt: new Date(),
          },
        });
        await tx.conversation.update({
          where: { id: conv.id },
          data: {
            // A complaint stays flagged until someone closes it.
            status: conv.status === 'COMPLAINT' ? 'COMPLAINT' : 'ANSWERED',
            lastMessageAt: now,
            ...(conv.assigneeId ? {} : { assigneeId: actor.staffId }),
          },
        });
        if (conv.customerId && part === 'text')
          await tx.message.create({
            data: {
              customerId: conv.customerId,
              channel: 'TELEGRAM',
              body: input.text,
              status: 'SENT',
              sentAt: new Date(),
              kind: 'service',
              payload: { chatId: String(conv.telegramChatId) },
            },
          });
        await this.audit.record(
          actor,
          {
            action: 'bot.conversation.reply',
            entity: 'Conversation',
            entityId: conv.id,
            after:
              part === 'text'
                ? { part, length: input.text.length }
                : { part, product: product!.variantId },
          },
          tx,
        );
      });

    let textSent = false;
    if (input.text) {
      try {
        await this.bot.send(conv.telegramChatId, {
          text: `<b>${html(`${operator} · ${copy(locale, 'specialist')}`)}</b>\n${html(input.text)}`,
        });
      } catch {
        // Blocked bot, network, Telegram refusal: nothing is recorded, the operator retries.
        throw new DomainError('BOT_SEND_FAILED');
      }
      await record('text', { operator });
      textSent = true;
    }
    if (product) {
      const button: BotButton = {
        text: copy(locale, 'addToCart'),
        url: this.links.addLinesUrl([{ variantId: product.variantId, qty: input.product!.qty }]),
      };
      try {
        await this.bot.send(conv.telegramChatId, {
          text: `<b>${html(product.name)}</b>${product.priceTiyin ? `\n${html(formatSoum(product.priceTiyin, locale))}` : ''}`,
          inline: [[button]],
          photoUrl: product.photoUrl,
        });
      } catch {
        throw new DomainError('BOT_SEND_FAILED', textSent ? { sent: 'text' } : undefined);
      }
      await record('product', {
        operator,
        product: {
          variantId: product.variantId,
          name: product.name,
          priceSoum: product.priceTiyin ? tiyinToSoumInt(product.priceTiyin) : null,
        },
      });
    }
    return this.detail(conv.id);
  }

  /** Another not-closed conversation of the same chat (there is at most one). */
  private async openSibling(conv: { id: string; telegramChatId: bigint }) {
    return this.prisma.conversation.findFirst({
      where: {
        telegramChatId: conv.telegramChatId,
        status: { not: 'CLOSED' },
        id: { not: conv.id },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  private async chatLocale(chatId: bigint, customerId: string | null): Promise<Locale> {
    const sub = await this.prisma.botSubscriber.findUnique({
      where: { telegramId: chatId },
      select: { locale: true },
    });
    if (sub?.locale) return sub.locale;
    if (!customerId) return 'uz';
    const c = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { locale: true },
    });
    return c?.locale ?? 'uz';
  }

  private async productCard(variantId: string, locale: Locale) {
    const v = await this.prisma.variant.findUnique({
      where: { id: variantId },
      include: {
        product: {
          include: { images: { include: { file: true }, orderBy: { sort: 'asc' }, take: 1 } },
        },
      },
    });
    if (!v || !v.active || v.product.status !== 'ACTIVE') return null;
    const label = t(v.label, locale);
    const file = v.product.images[0]?.file;
    return {
      variantId: v.id,
      name: `${t(v.product.name, locale)}${label ? ` · ${label}` : ''}`,
      priceTiyin: v.priceTiyin > 0n ? v.priceTiyin : null,
      photoUrl: file?.isPublic ? this.files.publicUrl(file.key) : null,
    };
  }

  /** Product card picker of the reply box (same search as the manual order form). */
  async variants(q: string): Promise<AdminVariantOptionDto[]> {
    const term = q.trim().slice(0, 64);
    const rows = await this.prisma.variant.findMany({
      where: {
        active: true,
        product: { status: 'ACTIVE' },
        ...(term
          ? {
              OR: [
                { sku: { contains: term, mode: 'insensitive' } },
                { product: { searchText: { contains: normalizeSearch(term) } } },
              ],
            }
          : {}),
      },
      include: { product: { select: { name: true } } },
      orderBy: [{ product: { popularity: 'desc' } }, { sku: 'asc' }],
      take: 20,
    });
    return rows.map((v) => ({
      id: v.id,
      sku: v.sku,
      name: t(v.product.name, 'uz'),
      label: t(v.label, 'uz'),
      priceSoum: tiyinToSoumInt(v.priceTiyin),
      available: Math.max(0, v.stock - v.reserved),
    }));
  }

  async patch(actor: AuditActor, id: string, input: BotConversationPatchInput) {
    let shownId = id;
    await this.prisma.$transaction(async (tx: Tx) => {
      const conv = await tx.conversation.findUnique({ where: { id } });
      if (!conv) throw new DomainError('BOT_CONVERSATION_NOT_FOUND');
      // One open conversation per chat: reopening an old one while a newer is open shows that one.
      if (input.status === 'OPEN' && conv.status === 'CLOSED') {
        const open = await tx.conversation.findFirst({
          where: {
            telegramChatId: conv.telegramChatId,
            status: { not: 'CLOSED' },
            id: { not: id },
          },
        });
        if (open && conv.telegramChatId !== 0n) {
          shownId = open.id;
          await this.audit.record(
            actor,
            {
              action: 'bot.conversation.update',
              entity: 'Conversation',
              entityId: id,
              after: { noop: true, openConversation: open.id },
            },
            tx,
          );
          return;
        }
      }
      if (input.assigneeId) {
        const s = await tx.staff.findUnique({ where: { id: input.assigneeId } });
        if (!s?.active || !hasPermission(s.role, 'bot.inbox'))
          throw new DomainError('VALIDATION_FAILED', undefined, 'assigneeId');
      }
      const data: Prisma.ConversationUpdateInput = {
        ...(input.status === 'CLOSED' ? { status: 'CLOSED' } : {}),
        // Reopened by staff: OPEN (seen, waiting for an answer).
        ...(input.status === 'OPEN' ? { status: 'OPEN' } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      };
      await tx.conversation.update({ where: { id }, data });
      await this.audit.record(
        actor,
        {
          action: 'bot.conversation.update',
          entity: 'Conversation',
          entityId: id,
          before: { status: conv.status, assigneeId: conv.assigneeId },
          after: {
            status: input.status ?? conv.status,
            assigneeId: input.assigneeId !== undefined ? input.assigneeId : conv.assigneeId,
          },
        },
        tx,
      );
    });
    return this.detail(shownId);
  }
}
