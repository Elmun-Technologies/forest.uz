import { Injectable } from '@nestjs/common';
import {
  CUSTOMER_EXPORT_MAX_ROWS,
  type CustomerDetailDto,
  type CustomerExportInput,
  type CustomerFilterOptionsDto,
  type CustomerListDto,
  type CustomerListItemDto,
  type CustomerListQuery,
  type CustomerNoteDto,
  type CustomerPiiDto,
  type CustomerTimelineItemDto,
  csvCell,
  DomainError,
  formatUzPhone,
  maskUzPhone,
  OPEN_ORDER_STATUSES,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  t,
  tiyinToSoumInt,
  UZ_REGIONS,
} from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { ConsentsService } from '../../customer/common/consents';
import { MeService } from '../../customer/me/me.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { type AuditActor, AuditService } from '../audit/audit.service';
import {
  countsSql,
  type CountsRow,
  encodeCursor,
  exportSql,
  listSql,
  oneSql,
  segmentsOf,
  type StatsRow,
} from './customer-query';

/** Payment states that settle what the customer sees (same rule as the order page). */
const SETTLED: readonly string[] = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const TIMELINE_LIMIT = 120;

function listItem(r: StatsRow): CustomerListItemDto {
  return {
    id: r.id,
    publicId: r.publicId,
    name: r.name,
    phoneMasked: r.phone ? maskUzPhone(r.phone) : null,
    hasTelegram: r.hasTelegram,
    region: r.region,
    firstSource: r.firstSource,
    purchases: r.purchases,
    ltvSoum: tiyinToSoumInt(r.ltv),
    lastActivityAt: r.lastActivity.toISOString(),
    createdAt: r.createdAt.toISOString(),
    segments: segmentsOf(r),
    consents: { sms: r.smsConsent === true, telegram: r.tgConsent === true },
    tags: r.tags ?? [],
  };
}

function touchField(touch: Prisma.JsonValue | null, key: string): string | null {
  if (!touch || typeof touch !== 'object' || Array.isArray(touch)) return null;
  const v = (touch as Record<string, unknown>)[key];
  return typeof v === 'string' && v ? v.slice(0, 120) : null;
}

/**
 * Admin A4 Customers / A5 Customer 360° (basic). Lists and the detail view carry masked phones
 * only; unmasked data goes through `reveal()` (audited). See CLAUDE.md §6 for the stat and segment
 * definitions.
 */
@Injectable()
export class AdminCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly consents: ConsentsService,
    private readonly me: MeService,
  ) {}

  private async abandonedMinutes(): Promise<number> {
    return (await this.settings.get('messaging.rules')).abandonedCartMinutes;
  }

  async list(q: CustomerListQuery, now = new Date()): Promise<CustomerListDto> {
    const minutes = await this.abandonedMinutes();
    const [rows, [counts]] = await Promise.all([
      this.prisma.$queryRaw<StatsRow[]>(
        listSql({
          now,
          abandonedCartMinutes: minutes,
          filters: q,
          sort: q.sort,
          cursor: q.cursor,
          limit: q.limit,
        }),
      ),
      this.prisma.$queryRaw<CountsRow[]>(countsSql(now, minutes, q)),
    ]);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    const c: CountsRow = counts ?? {
      all: 0,
      new: 0,
      loyal: 0,
      abandoned: 0,
      inactive: 0,
      leads: 0,
    };
    return {
      items: page.map(listItem),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.sortKey, last.id) : null,
      total: c[q.segment],
      counts: c,
    };
  }

  async filterOptions(): Promise<CustomerFilterOptionsDto> {
    const [sources, products] = await Promise.all([
      this.prisma.$queryRaw<{ source: string }[]>`
        SELECT DISTINCT COALESCE(NULLIF(c."firstTouch"->>'source', ''), c."leadSource") AS source
        FROM "Customer" c
        WHERE c."deletedAt" IS NULL
          AND COALESCE(NULLIF(c."firstTouch"->>'source', ''), c."leadSource") IS NOT NULL
        ORDER BY 1 LIMIT 100`,
      this.prisma.$queryRaw<{ id: string; name: Prisma.JsonValue }[]>`
        SELECT DISTINCT p.id, p.name FROM "Product" p
        JOIN "Variant" v ON v."productId" = p.id
        JOIN "OrderItem" oi ON oi."variantId" = v.id
        JOIN "Payment" pay ON pay."orderId" = oi."orderId"
          AND pay.status IN ('PAID', 'PARTIALLY_REFUNDED')
        LIMIT 500`,
    ]);
    return {
      regions: UZ_REGIONS.map((r) => r.code),
      sources: sources.map((s) => s.source),
      products: products
        .map((p) => ({ id: p.id, name: t(p.name, 'uz') }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  private async stats(id: string, now = new Date()): Promise<StatsRow> {
    const [row] = await this.prisma.$queryRaw<StatsRow[]>(
      oneSql(now, await this.abandonedMinutes(), id),
    );
    if (!row) throw new DomainError('NOT_FOUND');
    return row;
  }

  async detail(id: string): Promise<CustomerDetailDto> {
    const stats = await this.stats(id);
    const c = await this.prisma.customer.findUniqueOrThrow({
      where: { id },
      include: {
        _count: { select: { addresses: true } },
        consents: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
        notes: { orderBy: { createdAt: 'desc' }, take: 100 },
        orders: {
          orderBy: { createdAt: 'desc' },
          include: {
            payments: { orderBy: { createdAt: 'desc' } },
            events: { orderBy: { createdAt: 'desc' }, take: 40 },
          },
        },
        reviews: { orderBy: { createdAt: 'desc' }, take: 30 },
        messages: { orderBy: { createdAt: 'desc' }, take: 60 },
      },
    });
    const staffIds = [...new Set(c.notes.map((n) => n.staffId))];
    const staff = await this.prisma.staff.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, name: true },
    });
    const staffName = new Map(staff.map((s) => [s.id, s.name]));
    const notes: CustomerNoteDto[] = c.notes.map((n) => ({
      id: n.id,
      text: n.text,
      staffName: staffName.get(n.staffId) ?? null,
      createdAt: n.createdAt.toISOString(),
    }));

    const orders = c.orders.map((o) => {
      const payment = o.payments.find((p) => SETTLED.includes(p.status)) ?? o.payments[0];
      return {
        id: o.id,
        number: o.number,
        createdAt: o.createdAt.toISOString(),
        status: o.status as OrderStatus,
        paymentMethod: o.paymentMethod as PaymentMethod,
        paymentStatus: (payment?.status ?? null) as PaymentStatus | null,
        totalSoum: tiyinToSoumInt(o.totalTiyin),
        carrier: o.carrier,
      };
    });

    const timeline: CustomerTimelineItemDto[] = [
      { kind: 'created' as const, at: c.createdAt.toISOString() },
      ...(c.leadAt
        ? [{ kind: 'lead' as const, at: c.leadAt.toISOString(), source: c.leadSource }]
        : []),
      ...c.orders.flatMap((o): CustomerTimelineItemDto[] => [
        {
          kind: 'order_created',
          at: o.createdAt.toISOString(),
          orderNumber: o.number,
          totalSoum: tiyinToSoumInt(o.totalTiyin),
          paymentMethod: o.paymentMethod as PaymentMethod,
        },
        ...o.events.map((e): CustomerTimelineItemDto => ({
          kind: 'order_event',
          at: e.createdAt.toISOString(),
          orderNumber: o.number,
          type: e.type,
          from: e.from,
          to: e.to,
          actorType: e.actorType,
        })),
      ]),
      ...c.messages.map((m): CustomerTimelineItemDto => ({
        kind: 'message',
        at: m.createdAt.toISOString(),
        channel: m.channel,
        templateKey: m.templateKey,
        status: m.status,
        marketing: m.marketing,
      })),
      ...c.consents.map((x): CustomerTimelineItemDto => ({
        kind: 'consent',
        at: x.createdAt.toISOString(),
        channel: x.channel,
        granted: x.granted,
        source: x.source,
      })),
      ...c.reviews.map((r): CustomerTimelineItemDto => ({
        kind: 'review',
        at: r.createdAt.toISOString(),
        rating: r.rating,
        status: r.status,
      })),
      ...notes.map((n): CustomerTimelineItemDto => ({
        kind: 'note',
        at: n.createdAt,
        staffName: n.staffName,
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, TIMELINE_LIMIT);

    const request = await this.erasureRequest(c.id);
    const source = touchField(c.firstTouch, 'source');
    return {
      id: c.id,
      publicId: c.publicId,
      name: c.name,
      phoneMasked: c.phone ? maskUzPhone(c.phone) : null,
      hasPhone: c.phone !== null,
      hasTelegram: c.telegramId !== null,
      region: stats.region,
      firstSource: stats.firstSource,
      firstTouch: source
        ? {
            source,
            medium: touchField(c.firstTouch, 'medium'),
            campaign: touchField(c.firstTouch, 'campaign'),
          }
        : null,
      locale: c.locale,
      createdAt: c.createdAt.toISOString(),
      lastActivityAt: stats.lastActivity.toISOString(),
      tags: c.tags,
      segments: c.deletedAt ? [] : segmentsOf(stats),
      erasedAt: c.deletedAt?.toISOString() ?? null,
      erasureRequest: c.deletedAt ? null : request,
      kpis: {
        ltvSoum: tiyinToSoumInt(stats.ltv),
        purchases: stats.purchases,
        aovSoum: stats.purchases ? Math.round(tiyinToSoumInt(stats.ltv) / stats.purchases) : null,
        ordersTotal: stats.ordersTotal,
      },
      orders,
      consents: {
        current: await this.consents.current(c.id),
        history: c.consents.map((x) => ({
          channel: x.channel,
          granted: x.granted,
          source: x.source,
          at: x.createdAt.toISOString(),
        })),
      },
      addressesCount: c._count.addresses,
      openOrders: c.orders.filter((o) => OPEN_ORDER_STATUSES.includes(o.status as OrderStatus))
        .length,
      notes,
      timeline,
    };
  }

  /** Latest cabinet erasure request (written by `MeService.requestDeletion`). */
  private async erasureRequest(id: string): Promise<CustomerDetailDto['erasureRequest']> {
    const row = await this.prisma.auditLog.findFirst({
      where: { action: 'customer.erase_requested', entity: 'Customer', entityId: id },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    const after = row.after as { dueBy?: unknown } | null;
    const dueBy =
      typeof after?.dueBy === 'string'
        ? after.dueBy
        : new Date(row.createdAt.getTime() + 30 * 86_400_000).toISOString();
    return { requestedAt: row.createdAt.toISOString(), dueBy };
  }

  /** Full phone, addresses, Telegram username — logged as `customer.view_pii` (docs/02). */
  async reveal(actor: AuditActor, id: string): Promise<CustomerPiiDto> {
    const exists = await this.prisma.customer.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new DomainError('NOT_FOUND');
    return this.audit.reveal(
      actor,
      { entity: 'Customer', entityId: id, fields: ['phone', 'addresses', 'telegramUsername'] },
      async () => {
        const c = await this.prisma.customer.findUniqueOrThrow({
          where: { id },
          include: { addresses: { orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] } },
        });
        return {
          phone: c.phone ? formatUzPhone(c.phone) : null,
          telegramUsername: c.telegramUsername,
          addresses: c.addresses.map((a) => ({
            id: a.id,
            label: a.label,
            region: a.region,
            district: a.district,
            line: a.line,
            isDefault: a.isDefault,
          })),
        };
      },
    );
  }

  async setTags(actor: AuditActor, id: string, tags: string[]): Promise<{ tags: string[] }> {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.customer.findUnique({
        where: { id },
        select: { tags: true, deletedAt: true },
      });
      if (!c) throw new DomainError('NOT_FOUND');
      if (c.deletedAt) throw new DomainError('CUSTOMER_ERASED');
      await tx.customer.update({ where: { id }, data: { tags } });
      await this.audit.record(
        actor,
        {
          action: 'customer.tags_update',
          entity: 'Customer',
          entityId: id,
          before: { tags: c.tags },
          after: { tags },
        },
        tx,
      );
      return { tags };
    });
  }

  async addNote(actor: AuditActor, id: string, text: string): Promise<CustomerNoteDto> {
    if (!actor.staffId) throw new DomainError('UNAUTHORIZED');
    const staffId = actor.staffId;
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.customer.findUnique({ where: { id }, select: { deletedAt: true } });
      if (!c) throw new DomainError('NOT_FOUND');
      if (c.deletedAt) throw new DomainError('CUSTOMER_ERASED');
      const note = await tx.customerNote.create({ data: { customerId: id, staffId, text } });
      // Note texts are free text about a person: the audit keeps the fact, not the content.
      await this.audit.record(
        actor,
        {
          action: 'customer.note_added',
          entity: 'Customer',
          entityId: id,
          after: { noteId: note.id, length: text.length },
        },
        tx,
      );
      const staff = await tx.staff.findUnique({ where: { id: staffId }, select: { name: true } });
      return {
        id: note.id,
        text: note.text,
        staffName: staff?.name ?? null,
        createdAt: note.createdAt.toISOString(),
      };
    });
  }

  /** One customer's data (docs/14 data subject request), audited with the staff actor. */
  async exportOne(actor: AuditActor, id: string): Promise<Record<string, unknown>> {
    const data = await this.me.collectExport(id);
    if (!data) {
      const c = await this.prisma.customer.findUnique({ where: { id }, select: { id: true } });
      throw new DomainError(c ? 'CUSTOMER_ERASED' : 'NOT_FOUND');
    }
    await this.audit.record(actor, {
      action: 'customer.data_export',
      entity: 'Customer',
      entityId: id,
      after: { by: 'admin' },
    });
    return data;
  }

  /** CSV of the current filter (Owner). Phones masked unless `reveal` (recorded as such). */
  async exportCsv(actor: AuditActor, input: CustomerExportInput): Promise<string> {
    const { reveal, ...filters } = input;
    const rows = await this.prisma.$queryRaw<StatsRow[]>(
      exportSql(new Date(), await this.abandonedMinutes(), filters, CUSTOMER_EXPORT_MAX_ROWS),
    );
    if (rows.length > CUSTOMER_EXPORT_MAX_ROWS)
      throw new DomainError('VALIDATION_FAILED', { max: CUSTOMER_EXPORT_MAX_ROWS }, 'segment');
    const header = [
      'id',
      'name',
      'phone',
      'region',
      'first_source',
      'purchases',
      'ltv_soum',
      'last_activity',
      'customer_since',
      'segments',
      'sms_consent',
      'telegram_consent',
      'tags',
    ];
    const lines = rows.map((r) => {
      const item = listItem(r);
      const phone = r.phone ? (reveal ? r.phone : maskUzPhone(r.phone)) : '';
      return [
        item.publicId,
        item.name,
        phone,
        item.region,
        item.firstSource,
        item.purchases,
        item.ltvSoum,
        item.lastActivityAt,
        item.createdAt,
        item.segments.join(' '),
        item.consents.sms ? 'yes' : 'no',
        item.consents.telegram ? 'yes' : 'no',
        item.tags.join(' '),
      ]
        .map(csvCell)
        .join(',');
    });
    await this.audit.record(actor, {
      action: 'customer.export',
      entity: 'Customer',
      entityId: null,
      after: {
        filters: { ...filters, q: filters.q ? '[search]' : undefined },
        rows: rows.length,
        revealed: reveal,
      },
    });
    // BOM: Excel opens UTF-8 (Uzbek/Russian names) correctly.
    return `\uFEFF${[header.join(','), ...lines].join('\r\n')}\r\n`;
  }
}
