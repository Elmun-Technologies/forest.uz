import { Injectable } from '@nestjs/common';
import {
  ADMIN_ORDER_TABS,
  ADMIN_TAB_STATUSES,
  type AdminOrderBadgeDto,
  type AdminOrderDetailDto,
  type AdminOrderFilter,
  type AdminOrderListItemDto,
  type AdminOrderPageDto,
  type AdminOrderPiiDto,
  type AdminOrderQuery,
  type AdminOrderStepDto,
  type AdminOrderTab,
  type AdminShipmentDto,
  type AdminShipmentHistoryDto,
  type AdminTimelineEntryDto,
  type AdminVariantOptionDto,
  type Carrier,
  type DeliveryStatus,
  DomainError,
  formatTashkentDate,
  formatTashkentHm,
  formatUzPhone,
  maskUzPhone,
  normalizeSearch,
  type OrderStatus,
  type OrderStepKey,
  type PaymentStatus,
  type Permission,
  SLA_OPEN_STATUSES,
  SLA_RISK_WINDOW_MS,
  slaState,
  type SlaStateDto,
  t,
  tiyinToSoumInt,
  UZ_REGIONS,
} from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { fiscalEvidence } from '../../commerce/fiscal.service';
import { maskAnyPhone } from '../../commerce/orders.service';
import { FilesService } from '../../files/files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { orderActions } from './order-actions';
import {
  afterCursor,
  baseWhere,
  cursorValue,
  decodeCursor,
  encodeCursor,
  listWhere,
  orderBy,
  type SearchScope,
  tabWhere,
} from './order-query';

const listSelect = {
  id: true,
  number: true,
  createdAt: true,
  status: true,
  source: true,
  contactName: true,
  contactPhone: true,
  address: true,
  totalTiyin: true,
  paymentMethod: true,
  carrier: true,
  slaDueAt: true,
  customerId: true,
  items: { select: { nameSnapshot: true, qty: true } },
  payments: { select: { status: true, method: true }, orderBy: { createdAt: 'desc' } },
  shipments: { select: { status: true, trackNumber: true, carrier: true } },
} satisfies Prisma.OrderSelect;

type ListRow = Prisma.OrderGetPayload<{ select: typeof listSelect }>;

const detailInclude = {
  items: {
    include: {
      variant: {
        include: {
          product: {
            include: { images: { include: { file: true }, orderBy: { sort: 'asc' }, take: 1 } },
          },
        },
      },
    },
  },
  payments: {
    orderBy: { createdAt: 'asc' },
    include: { refunds: { orderBy: { createdAt: 'asc' } } },
  },
  shipments: { orderBy: { createdAt: 'asc' } },
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  fiscalReceipts: { where: { kind: 'SALE' } },
} satisfies Prisma.OrderInclude;

/** Payment states that settle what staff see, whatever later attempts did (as the storefront). */
const SETTLED: readonly PaymentStatus[] = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];
/** Payments that count as a purchase for LTV (same as the customers module). */
const PURCHASE_PAYMENT = ['PAID', 'PARTIALLY_REFUNDED'] as const;
/** Fulfilment path shown as the A7 stepper. */
const STEPS: readonly OrderStepKey[] = [
  'NEW',
  'CONFIRMED',
  'PACKING',
  'READY',
  'HANDED_TO_COURIER',
  'DELIVERED',
  'COMPLETED',
];
/** Event data keys safe to show staff (no PII, no secrets). */
const EVENT_DATA_KEYS = [
  'reason',
  'cause',
  'delivery',
  'carrier',
  'claimId',
  'template',
  'method',
  'paymentMethod',
  'zone',
  'source',
  'trackNumber',
  'provider',
  'receiptNumber',
  'corrected',
  'paidAllowed',
  'manual',
  'mode',
  'channel',
] as const;
/** CSV export cap: an operational list, not a database dump. */
export const EXPORT_MAX_ROWS = 5000;
/** Byte-order mark: Excel then opens the UTF-8 CSV (Uzbek/Russian names) correctly. */
const BOM = '\uFEFF';

type Address = { region?: string; district?: string | null; line?: string };

export function displayPaymentStatus(
  payments: readonly { status: PaymentStatus }[],
): PaymentStatus | null {
  return (payments.find((p) => SETTLED.includes(p.status)) ?? payments[0])?.status ?? null;
}

function searchScope(permissions: readonly Permission[]): SearchScope {
  return { phones: permissions.includes('customers.pii') };
}

function regionLabel(code: string | undefined): string {
  return UZ_REGIONS.find((r) => r.code === code)?.uz ?? code ?? '';
}

function orderSla(status: OrderStatus, due: Date | null, now: Date): SlaStateDto | null {
  return due && SLA_OPEN_STATUSES.includes(status) ? slaState(due, now, SLA_RISK_WINDOW_MS) : null;
}

function itemName(snapshot: unknown): { name: string; variant: string } {
  const s = snapshot as { product?: unknown; variant?: unknown } | null;
  return { name: t(s?.product, 'uz'), variant: t(s?.variant, 'uz') };
}

function itemsSummary(items: readonly { nameSnapshot: unknown; qty: number }[]): string {
  return items
    .map((i) => {
      const n = itemName(i.nameSnapshot);
      const label = [n.name, n.variant].filter(Boolean).join(' ');
      return i.qty > 1 ? `${label} ×${i.qty}` : label;
    })
    .join(', ');
}

/** CSV cell: quoted, and spreadsheet formulas neutralised (CSV injection). */
function csvCell(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** A6/A7 reads: list + tab counts, badge, detail, PII reveal, CSV export, variant picker. */
@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async idByNumber(number: string): Promise<string> {
    const o = await this.prisma.order.findUnique({ where: { number }, select: { id: true } });
    if (!o) throw new DomainError('ORDER_NOT_FOUND');
    return o.id;
  }

  async list(
    q: AdminOrderQuery,
    permissions: readonly Permission[],
    now = new Date(),
  ): Promise<AdminOrderPageDto> {
    const scope = searchScope(permissions);
    const where: Prisma.OrderWhereInput = q.cursor
      ? { AND: [listWhere(q, scope, now), afterCursor(q.sort, decodeCursor(q.cursor))] }
      : listWhere(q, scope, now);
    const [rows, counts] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: orderBy(q.sort),
        take: q.limit + 1,
        select: listSelect,
      }),
      this.counts(q, scope, now),
    ]);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => this.listItem(r, now)),
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ v: cursorValue(q.sort, last), id: last.id })
          : null,
      ...counts,
      serverNow: now.toISOString(),
    };
  }

  private listItem(r: ListRow, now: Date): AdminOrderListItemDto {
    const address = r.address as Address;
    const shipment = r.shipments.find((s) => s.carrier === r.carrier) ?? r.shipments[0];
    return {
      id: r.id,
      number: r.number,
      createdAt: r.createdAt.toISOString(),
      status: r.status,
      source: r.source,
      customer: {
        id: r.customerId,
        name: r.contactName,
        city: regionLabel(address.region),
        phoneMasked: maskUzPhone(r.contactPhone),
      },
      itemsSummary: itemsSummary(r.items),
      itemsCount: r.items.reduce((n, i) => n + i.qty, 0),
      totalSoum: tiyinToSoumInt(r.totalTiyin),
      payment: { method: r.paymentMethod, status: displayPaymentStatus(r.payments) },
      carrier: r.carrier,
      delivery: {
        status: shipment?.status ?? 'NOT_CREATED',
        trackNumber: shipment?.trackNumber ?? null,
      },
      slaDueAt: r.slaDueAt?.toISOString() ?? null,
      sla: orderSla(r.status, r.slaDueAt, now),
    };
  }

  /** Tab counts honour every other filter; in-transit split by carrier for the KPI tiles. */
  private async counts(
    f: AdminOrderFilter,
    scope: SearchScope,
    now: Date,
  ): Promise<Pick<AdminOrderPageDto, 'counts' | 'inTransitByCarrier'>> {
    const base = baseWhere(f, scope);
    const [groups, slaRisk] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['status', 'paymentMethod', 'carrier'],
        where: base,
        _count: { _all: true },
      }),
      this.prisma.order.count({ where: { AND: [base, tabWhere('sla_risk', now)] } }),
    ]);
    const counts = Object.fromEntries(ADMIN_ORDER_TABS.map((k) => [k, 0])) as Record<
      AdminOrderTab,
      number
    >;
    const inTransitByCarrier: Record<Carrier, number> = { YANDEX: 0, BTS: 0, PICKUP: 0 };
    for (const g of groups) {
      const n = g._count._all;
      counts.all += n;
      if (g.status === 'NEW')
        counts[g.paymentMethod === 'COD' ? 'confirm' : 'awaiting_payment'] += n;
      for (const tab of ['to_pack', 'in_transit', 'delivered', 'returns', 'cancelled'] as const)
        if (ADMIN_TAB_STATUSES[tab].includes(g.status)) counts[tab] += n;
      if (g.status === 'HANDED_TO_COURIER') inTransitByCarrier[g.carrier] += n;
    }
    counts.sla_risk = slaRisk;
    return { counts, inTransitByCarrier };
  }

  /** Sidebar badge (CLAUDE.md §6): COD orders to confirm + orders to pack/ship. */
  async badge(now = new Date()): Promise<AdminOrderBadgeDto> {
    const [count, slaRisk] = await Promise.all([
      this.prisma.order.count({
        where: { OR: [tabWhere('confirm', now), tabWhere('to_pack', now)] },
      }),
      this.prisma.order.count({ where: tabWhere('sla_risk', now) }),
    ]);
    return { count, slaRisk };
  }

  async detail(
    number: string,
    permissions: readonly Permission[],
    now = new Date(),
  ): Promise<AdminOrderDetailDto> {
    const o = await this.prisma.order.findUnique({ where: { number }, include: detailInclude });
    if (!o) throw new DomainError('ORDER_NOT_FOUND');
    const [zones, evidence, customer] = await Promise.all([
      this.settings.get('delivery.zones'),
      fiscalEvidence(this.prisma, o.id),
      this.customerCard(o.customerId, o.createdAt, o.id),
    ]);
    const staffIds = [
      ...new Set([
        ...o.events.filter((e) => e.actorType === 'STAFF' && e.actorId).map((e) => e.actorId!),
        ...o.payments.flatMap((p) => p.refunds.map((r) => r.staffId)),
      ]),
    ];
    const staff = await this.prisma.staff.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, name: true },
    });
    const staffName = new Map(staff.map((s) => [s.id, s.name]));
    const address = o.address as Address;
    const zone = zones.find((z) => z.key === o.deliveryZone);
    const receipt = o.fiscalReceipts[0];

    return {
      id: o.id,
      number: o.number,
      publicId: o.publicId,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      source: o.source,
      locale: o.locale,
      promoCode: o.promoCode,
      comment: o.comment,
      cancelReason: o.cancelReason,
      zone: { key: o.deliveryZone, name: zone ? t(zone.name, 'uz') : o.deliveryZone },
      carrier: o.carrier,
      slaDueAt: o.slaDueAt?.toISOString() ?? null,
      sla: orderSla(o.status, o.slaDueAt, now),
      serverNow: now.toISOString(),
      contact: {
        name: o.contactName,
        phoneMasked: maskUzPhone(o.contactPhone),
        region: regionLabel(address.region),
        district: address.district ?? null,
      },
      items: o.items.map((i) => {
        const n = itemName(i.nameSnapshot);
        const img = i.variant.product.images[0];
        return {
          id: i.id,
          name: n.name,
          variantLabel: n.variant,
          sku: i.sku,
          ikpu: i.ikpu,
          qty: i.qty,
          unitSoum: tiyinToSoumInt(i.priceTiyin),
          discountSoum: tiyinToSoumInt(i.discountTiyin),
          lineSoum: tiyinToSoumInt(i.priceTiyin * BigInt(i.qty) - i.discountTiyin),
          image: img ? (this.files.image(img.file, img.alt, 'uz')?.url ?? null) : null,
        };
      }),
      totals: {
        subtotalSoum: tiyinToSoumInt(o.subtotalTiyin),
        discountSoum: tiyinToSoumInt(o.discountTiyin),
        shippingSoum: tiyinToSoumInt(o.shippingTiyin),
        totalSoum: tiyinToSoumInt(o.totalTiyin),
      },
      paymentMethod: o.paymentMethod,
      paymentStatus: displayPaymentStatus([...o.payments].reverse()),
      payments: o.payments.map((p) => ({
        id: p.id,
        method: p.method,
        status: p.status,
        amountSoum: tiyinToSoumInt(p.amountTiyin),
        refundedSoum: tiyinToSoumInt(p.refunds.reduce((s, r) => s + r.amountTiyin, 0n)),
        providerTxnId: p.providerTxnId,
        createdAt: p.createdAt.toISOString(),
        performedAt: p.performedAt?.toISOString() ?? null,
        cancelledAt: p.cancelledAt?.toISOString() ?? null,
        fiscalReceiptUrl: p.fiscalReceiptUrl,
        refunds: p.refunds.map((r) => ({
          id: r.id,
          amountSoum: tiyinToSoumInt(r.amountTiyin),
          reason: r.reason,
          createdAt: r.createdAt.toISOString(),
          by: r.staffId.startsWith('provider:')
            ? r.staffId.slice('provider:'.length)
            : (staffName.get(r.staffId) ?? '—'),
        })),
      })),
      fiscal: {
        evidence,
        receipt: receipt
          ? {
              receiptNumber: receipt.receiptNumber,
              url: receipt.url,
              createdAt: receipt.createdAt.toISOString(),
            }
          : null,
      },
      shipments: o.shipments.map((s) => this.shipmentDto(s, now)),
      steps: this.steps(o),
      actions: orderActions(
        {
          status: o.status,
          carrier: o.carrier,
          payments: o.payments,
          shipments: o.shipments,
          fiscalEvidence: evidence !== null,
        },
        permissions,
        now,
      ),
      timeline: o.events.map((e) => this.timelineEntry(e, staffName)),
      customer,
    };
  }

  private shipmentDto(s: Prisma.ShipmentGetPayload<object>, now: Date): AdminShipmentDto {
    const courier = s.courier as {
      name?: string;
      phone?: string | null;
      car?: string | null;
      plate?: string | null;
      etaAt?: string | null;
    } | null;
    const history = (Array.isArray(s.history) ? s.history : []) as {
      at?: string;
      status?: DeliveryStatus;
      providerStatus?: string | null;
      place?: string | null;
      note?: string | null;
    }[];
    const accept = (s.providerData as { acceptRequest?: { at?: string; claimId?: string } } | null)
      ?.acceptRequest;
    return {
      id: s.id,
      carrier: s.carrier,
      status: s.status,
      providerStatus: s.providerStatus,
      externalId: s.externalId,
      trackNumber: s.trackNumber,
      branch: (s.branch as { name?: string } | null)?.name ?? null,
      priceSoum: tiyinToSoumInt(s.priceTiyin),
      acceptedAt: s.acceptedAt?.toISOString() ?? null,
      acceptPending: Boolean(
        accept?.at &&
        accept.claimId === s.externalId &&
        now.getTime() - Date.parse(accept.at) < 2 * 60_000,
      ),
      courier: courier?.name
        ? {
            name: courier.name,
            car: courier.car ?? null,
            plate: courier.plate ?? null,
            phoneMasked: courier.phone ? maskAnyPhone(courier.phone) : null,
            etaAt: courier.etaAt ?? null,
          }
        : null,
      history: history
        .filter((h) => h.at && h.status)
        .map((h): AdminShipmentHistoryDto => ({
          at: h.at!,
          status: h.status!,
          providerStatus: h.providerStatus ?? null,
          place: h.place || null,
          note: h.note || null,
        })),
    };
  }

  private steps(o: {
    status: OrderStatus;
    createdAt: Date;
    events: readonly { type: string; to: string | null; createdAt: Date }[];
  }): AdminOrderStepDto[] {
    const at = (key: OrderStepKey) =>
      key === 'NEW'
        ? o.createdAt.toISOString()
        : (o.events
            .find((e) => e.type === 'STATUS_CHANGED' && e.to === key)
            ?.createdAt.toISOString() ?? null);
    const current = STEPS.indexOf(o.status as OrderStepKey);
    return STEPS.map((key, i) => {
      const when = at(key);
      const state =
        current >= 0
          ? i < current
            ? 'done'
            : i === current
              ? 'current'
              : 'upcoming'
          : when
            ? 'done'
            : 'upcoming';
      return { key, at: when, state };
    });
  }

  private timelineEntry(
    e: Prisma.OrderEventGetPayload<object>,
    staffName: Map<string, string>,
  ): AdminTimelineEntryDto {
    const raw = (
      e.data && typeof e.data === 'object' && !Array.isArray(e.data) ? e.data : {}
    ) as Record<string, unknown>;
    const data: AdminTimelineEntryDto['data'] = {};
    for (const k of EVENT_DATA_KEYS) {
      const v = raw[k];
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v))
        data[k] = v as string | number | boolean | null;
    }
    const note =
      e.type === 'NOTE' && typeof raw.text === 'string'
        ? raw.text
        : typeof raw.note === 'string'
          ? raw.note
          : null;
    const name =
      e.actorType === 'STAFF'
        ? (staffName.get(e.actorId ?? '') ?? null)
        : e.actorType === 'CARRIER' || e.actorType === 'PAYMENT_PROVIDER'
          ? e.actorId
          : null;
    return {
      id: e.id,
      at: e.createdAt.toISOString(),
      type: e.type,
      from: e.from,
      to: e.to,
      actor: { type: e.actorType, name },
      note,
      data,
    };
  }

  /**
   * Customer card: aggregates over the customer's orders (no cached counters). LTV = PAID /
   * PARTIALLY_REFUNDED payments minus their refunds — the A4/A5 definition (CLAUDE.md §6).
   */
  private async customerCard(customerId: string, createdAt: Date, orderId: string) {
    const [customer, live, before, paid, refunded] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, publicId: true, name: true, tags: true },
      }),
      this.prisma.order.count({ where: { customerId, status: { not: 'CANCELLED' } } }),
      this.prisma.order.count({
        where: {
          customerId,
          OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: orderId } }],
        },
      }),
      this.prisma.payment.aggregate({
        where: { status: { in: [...PURCHASE_PAYMENT] }, order: { customerId } },
        _sum: { amountTiyin: true },
      }),
      this.prisma.refund.aggregate({
        where: { payment: { status: { in: [...PURCHASE_PAYMENT] }, order: { customerId } } },
        _sum: { amountTiyin: true },
      }),
    ]);
    if (!customer) return null;
    return {
      id: customer.id,
      publicId: customer.publicId,
      name: customer.name,
      ordersCount: live,
      ltvSoum: tiyinToSoumInt((paid._sum.amountTiyin ?? 0n) - (refunded._sum.amountTiyin ?? 0n)),
      nth: before + 1,
      tags: customer.tags,
    };
  }

  /**
   * Full receiver data (docs/02 "full value on detail view for permitted roles, access logged").
   * `customers.pii`: phone + address; Warehouse (`customers.pii_partial`): address only.
   */
  async pii(
    actor: AuditActor,
    number: string,
    permissions: readonly Permission[],
  ): Promise<AdminOrderPiiDto> {
    const full = permissions.includes('customers.pii');
    if (!full && !permissions.includes('customers.pii_partial'))
      throw new DomainError('ADMIN_PII_FORBIDDEN');
    const o = await this.prisma.order.findUnique({
      where: { number },
      select: { id: true, contactPhone: true, address: true },
    });
    if (!o) throw new DomainError('ORDER_NOT_FOUND');
    const fields = full ? ['contactPhone', 'address'] : ['address'];
    return this.audit.reveal(
      actor,
      { entity: 'Order', entityId: o.id, fields, action: 'order.view_pii' },
      async () => {
        const a = o.address as Address;
        return {
          phone: full ? formatUzPhone(o.contactPhone) : null,
          address: {
            region: regionLabel(a.region),
            district: a.district ?? null,
            line: a.line ?? '',
          },
        };
      },
    );
  }

  /** CSV of the current filter (CLAUDE.md §6): masked unless the staff may export customers. */
  async exportCsv(
    actor: AuditActor,
    f: AdminOrderFilter,
    permissions: readonly Permission[],
    now = new Date(),
  ): Promise<{ csv: string; rows: number }> {
    const full = permissions.includes('customers.export');
    const rows = await this.prisma.order.findMany({
      where: listWhere(f, searchScope(permissions), now),
      orderBy: orderBy(f.sort),
      take: EXPORT_MAX_ROWS,
      select: listSelect,
    });
    const header = [
      'Raqam',
      'Sana',
      'Vaqt',
      'Holat',
      'Mijoz',
      'Telefon',
      'Viloyat',
      ...(full ? ['Manzil'] : []),
      'Mahsulotlar',
      "Summa (so'm)",
      "To'lov usuli",
      "To'lov holati",
      'Yetkazish',
      'Yetkazish holati',
      'Trek raqami',
      'Manba',
      'SLA muddati',
    ];
    const lines = rows.map((r) => {
      const a = r.address as Address;
      const item = this.listItem(r, now);
      return [
        r.number,
        formatTashkentDate(r.createdAt),
        formatTashkentHm(r.createdAt),
        r.status,
        r.contactName,
        full ? r.contactPhone : maskUzPhone(r.contactPhone),
        regionLabel(a.region),
        ...(full ? [[a.district, a.line].filter(Boolean).join(', ')] : []),
        item.itemsSummary,
        item.totalSoum,
        r.paymentMethod,
        item.payment.status,
        r.carrier,
        item.delivery.status,
        item.delivery.trackNumber,
        r.source,
        r.slaDueAt ? `${formatTashkentDate(r.slaDueAt)} ${formatTashkentHm(r.slaDueAt)}` : null,
      ]
        .map(csvCell)
        .join(',');
    });
    await this.audit.record(actor, {
      action: 'order.export',
      entity: 'Order',
      after: { filters: f, rows: rows.length, unmasked: full },
    });
    return {
      csv: `${BOM}${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`,
      rows: rows.length,
    };
  }

  /** Manual order line picker: sellable variants by name or SKU. */
  async variants(q: string): Promise<AdminVariantOptionDto[]> {
    const term = q.trim();
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
}
