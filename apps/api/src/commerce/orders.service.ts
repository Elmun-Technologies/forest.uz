import { Inject, Injectable } from '@nestjs/common';
import {
  canChangeAddress,
  DomainError,
  formatUzPhone,
  type Locale,
  maskUzPhone,
  type OrderPublicDto,
  type OrderTimelineStepDto,
  t,
  tiyinToSoumInt,
  type TrackingDto,
} from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const orderInclude = {
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
  payments: { orderBy: { createdAt: 'desc' } },
  shipments: true,
  events: { orderBy: { createdAt: 'asc' } },
  reservations: { where: { releasedAt: null } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** Payment states that settle what the customer sees, whatever later attempts did. */
const SETTLED = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];

const LABELS = {
  uz: {
    ACCEPTED: 'Qabul qilindi',
    PAID: "To'landi",
    CONFIRMED: 'Tasdiqlandi',
    PACKING: "Yig'ilmoqda",
    PACKED: "Yig'ildi",
    SHIPPED: "Yo'lda",
    DELIVERED: 'Yetkazildi',
  },
  ru: {
    ACCEPTED: 'Принят',
    PAID: 'Оплачен',
    CONFIRMED: 'Подтверждён',
    PACKING: 'Собирается',
    PACKED: 'Собран',
    SHIPPED: 'В пути',
    DELIVERED: 'Доставлен',
  },
} as const;

const RANK: Record<string, number> = {
  NEW: 0,
  CONFIRMED: 1,
  PACKING: 2,
  READY: 2.5,
  HANDED_TO_COURIER: 3,
  DELIVERED: 4,
  COMPLETED: 4,
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private eventAt(o: OrderRow, to: string): string | null {
    return (
      o.events.find((e) => e.type === 'STATUS_CHANGED' && e.to === to)?.createdAt.toISOString() ??
      null
    );
  }

  timeline(o: OrderRow, locale: Locale): OrderTimelineStepDto[] {
    const L = LABELS[locale];
    const paid = o.payments.find((p) => p.status === 'PAID');
    const rank = RANK[o.status] ?? -1;
    const isCod = o.paymentMethod === 'COD';
    const steps: {
      key: OrderTimelineStepDto['key'];
      label: string;
      at: string | null;
      reached: boolean;
    }[] = [
      { key: 'ACCEPTED', label: L.ACCEPTED, at: o.createdAt.toISOString(), reached: true },
      {
        key: 'PAID',
        label: isCod ? L.CONFIRMED : L.PAID,
        at: isCod ? this.eventAt(o, 'CONFIRMED') : (paid?.performedAt?.toISOString() ?? null),
        reached: isCod ? rank >= 1 : Boolean(paid),
      },
      {
        key: 'PACKING',
        label: rank >= 2.5 ? L.PACKED : L.PACKING,
        at: this.eventAt(o, 'PACKING'),
        reached: rank >= 2,
      },
      {
        key: 'SHIPPED',
        label: L.SHIPPED,
        at: this.eventAt(o, 'HANDED_TO_COURIER'),
        reached: rank >= 3,
      },
      {
        key: 'DELIVERED',
        label: L.DELIVERED,
        at: this.eventAt(o, 'DELIVERED') ?? o.slaDueAt?.toISOString() ?? null,
        reached: rank >= 4,
      },
    ];
    const currentIdx = steps.findIndex((s) => !s.reached);
    return steps.map((s, i) => ({
      key: s.key,
      label: s.label,
      // For not-yet-reached delivery we show the promised deadline as the expected time.
      at: s.reached || s.key === 'DELIVERED' ? s.at : null,
      state: s.reached ? 'done' : i === currentIdx ? 'current' : 'upcoming',
      note: null,
    }));
  }

  private async toDto(o: OrderRow, locale: Locale, isOwner: boolean): Promise<OrderPublicDto> {
    const store = await this.settings.get('store.info');
    // Newest first; a paid attempt wins over a newer open/expired sibling ("pay again" rows).
    const payment = o.payments.find((p) => SETTLED.includes(p.status)) ?? o.payments[0];
    const shipment = o.shipments[0];
    const address = o.address as { region: string; district: string | null; line: string };
    const reservationExpiresAt =
      o.status === 'NEW'
        ? (o.reservations
            .map((r) => r.expiresAt)
            .filter((d): d is Date => Boolean(d))
            .sort((a, b) => a.getTime() - b.getTime())[0] ?? null)
        : null;
    return {
      number: o.number,
      locale: o.locale,
      publicId: o.publicId,
      status: o.status,
      paymentStatus: payment?.status ?? 'PENDING',
      paymentMethod: o.paymentMethod,
      deliveryStatus: shipment?.status ?? 'NOT_CREATED',
      carrier: o.carrier,
      contactName: o.contactName,
      contactPhone: isOwner ? formatUzPhone(o.contactPhone) : maskUzPhone(o.contactPhone),
      // Street/house only for the owner; a forwarded link reveals at most region/district.
      address: {
        region: address.region,
        district: address.district ?? null,
        line: isOwner ? address.line : '',
      },
      items: o.items.map((i) => {
        const snap = i.nameSnapshot as { product?: unknown; variant?: unknown };
        const img = i.variant.product.images[0];
        return {
          name: t(snap.product, locale),
          variantLabel: t(snap.variant, locale),
          qty: i.qty,
          lineTotalSoum: tiyinToSoumInt(i.priceTiyin * BigInt(i.qty) - i.discountTiyin),
          image: img ? this.files.image(img.file, img.alt ?? i.variant.product.name, locale) : null,
        };
      }),
      subtotalSoum: tiyinToSoumInt(o.subtotalTiyin),
      discountSoum: tiyinToSoumInt(o.discountTiyin),
      shippingSoum: tiyinToSoumInt(o.shippingTiyin),
      totalSoum: tiyinToSoumInt(o.totalTiyin),
      promoCode: o.promoCode,
      slaDueAt: o.slaDueAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
      timeline: this.timeline(o, locale),
      trackingUrl: `${this.env.APP_URL}/t/${o.trackingToken}`,
      telegramDeepLink: store.telegramBot
        ? `https://t.me/${store.telegramBot}?start=o_${o.trackingToken}`
        : null,
      canRetryPayment:
        o.status === 'NEW' &&
        o.paymentMethod !== 'COD' &&
        (payment?.status === 'FAILED' || payment?.status === 'PENDING') &&
        Boolean(reservationExpiresAt && reservationExpiresAt > new Date()),
      reservationExpiresAt: reservationExpiresAt?.toISOString() ?? null,
      fiscalReceiptUrl: payment?.fiscalReceiptUrl ?? null,
    };
  }

  /**
   * Order-received page. The publicId is unguessable; the full phone is shown only to the owner
   * (session customer) — anyone else holding the link sees it masked.
   */
  async byPublicId(
    publicId: string,
    locale: Locale,
    isOwner: (orderCustomerId: string) => boolean,
  ): Promise<OrderPublicDto> {
    const o = await this.prisma.order.findUnique({ where: { publicId }, include: orderInclude });
    if (!o) throw new DomainError('ORDER_NOT_FOUND');
    return this.toDto(o, locale, isOwner(o.customerId));
  }

  async tracking(
    token: string,
    locale: Locale,
    viewerCustomerId: string | null,
  ): Promise<TrackingDto> {
    const o = await this.prisma.order.findUnique({
      where: { trackingToken: token },
      include: orderInclude,
    });
    if (!o) throw new DomainError('ORDER_NOT_FOUND');
    const base = await this.toDto(o, locale, viewerCustomerId === o.customerId);
    const shipment = o.shipments[0];
    const courier = shipment?.courier as {
      name?: string;
      car?: string | null;
      plate?: string | null;
      etaAt?: string | null;
      distanceKm?: number | null;
    } | null;
    const history =
      (shipment?.history as { at: string; place?: string; note?: string }[] | null) ?? [];
    return {
      ...base,
      courier: courier?.name
        ? {
            // First name + initial only: the tracking link is shareable (no PII in URL, minimal on page).
            name: courier.name.split(' ')[0] ?? courier.name,
            car: courier.car ?? null,
            plate: courier.plate ?? null,
            etaFrom: courier.etaAt ?? null,
            etaTo: courier.etaAt
              ? new Date(new Date(courier.etaAt).getTime() + 30 * 60_000).toISOString()
              : null,
            distanceKm: courier.distanceKm ?? null,
          }
        : null,
      carrierRef: shipment?.trackNumber ?? shipment?.externalId ?? null,
      history: history.map((h) => ({ at: h.at, place: h.place ?? '', note: h.note ?? '' })),
      canChangeAddress: canChangeAddress(o.status),
    };
  }

  async changeAddress(
    token: string,
    viewerCustomerId: string | null,
    addressLine: string,
    district: string | null,
  ): Promise<void> {
    const o = await this.prisma.order.findUnique({ where: { trackingToken: token } });
    if (!o) throw new DomainError('ORDER_NOT_FOUND');
    // Only the signed-in owner may change the address (the link alone is not proof of identity).
    if (!viewerCustomerId || viewerCustomerId !== o.customerId)
      throw new DomainError('UNAUTHORIZED');
    if (!canChangeAddress(o.status)) throw new DomainError('ADDRESS_LOCKED');
    const prev = o.address as Record<string, unknown>;
    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: o.id },
        data: {
          address: { ...prev, line: addressLine, district: district ?? prev.district ?? null },
        },
      }),
      this.prisma.orderEvent.create({
        data: {
          orderId: o.id,
          type: 'ADDRESS_CHANGED',
          actorType: 'CUSTOMER',
          actorId: viewerCustomerId,
        },
      }),
    ]);
  }

  /** GET /me/orders (cabinet history). */
  async forCustomer(customerId: string, locale: Locale): Promise<OrderPublicDto[]> {
    const rows = await this.prisma.order.findMany({
      where: { customerId },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return Promise.all(rows.map((o) => this.toDto(o, locale, true)));
  }
}
