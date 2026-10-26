import { Inject, Injectable } from '@nestjs/common';
import {
  assertPaymentTransition,
  type CheckoutInput,
  type CheckoutResultDto,
  DomainError,
  type Locale,
  pickZone,
  priceCart,
  soumToTiyin,
  t,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CartService } from './cart.service';
import { orderPublicId, trackingToken } from './ids';
import { NotificationsService } from './notifications.service';
import { PromoService } from './promo.service';
import { ReservationsService } from './reservations.service';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly carts: CartService,
    private readonly promos: PromoService,
    private readonly reservations: ReservationsService,
    private readonly settings: SettingsService,
    private readonly integrations: IntegrationsService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * POST /checkout/orders with an Idempotency-Key: a retried request (double click, flaky network)
   * returns the original result instead of creating a second order.
   */
  async placeIdempotent(
    req: Request,
    key: string,
    input: CheckoutInput,
    locale: Locale,
    deviceHash: string | null,
  ): Promise<CheckoutResultDto> {
    const cart = await this.carts.current(req);
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    // Hash the body only: after success the cart is converted, so a replay must not depend on it.
    try {
      await this.prisma.idempotencyKey.create({ data: { key, scope: 'checkout', requestHash } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const existing = await this.prisma.idempotencyKey.findUniqueOrThrow({ where: { key } });
      if (existing.scope !== 'checkout' || existing.requestHash !== requestHash)
        throw new DomainError('IDEMPOTENCY_CONFLICT');
      if (existing.response) return existing.response as unknown as CheckoutResultDto;
      throw new DomainError('IDEMPOTENCY_CONFLICT');
    }
    try {
      const result = await this.place(cart, input, locale, deviceHash);
      await this.prisma.idempotencyKey.update({
        where: { key },
        data: { status: 201, response: result as unknown as Prisma.InputJsonValue },
      });
      return result;
    } catch (e) {
      // Failed attempts must be retryable with the same key (e.g. after fixing a typo in the phone).
      await this.prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined);
      throw e;
    }
  }

  private async place(
    cart: Awaited<ReturnType<CartService['current']>>,
    input: CheckoutInput,
    locale: Locale,
    deviceHash: string | null,
  ): Promise<CheckoutResultDto> {
    if (!cart || cart.items.length === 0) throw new DomainError('CART_EMPTY');
    const [zones, rules, flags, promoRules] = await Promise.all([
      this.settings.get('delivery.zones'),
      this.settings.get('delivery.rules'),
      this.settings.get('flags'),
      this.settings.get('promo.rules'),
    ]);
    const zone = pickZone(zones, input.region, input.district).find((z) => z.key === input.zoneKey);
    if (!zone) throw new DomainError('DELIVERY_UNAVAILABLE', undefined, 'zoneKey');
    if (input.paymentMethod === 'COD' && !flags.cod)
      throw new DomainError('COD_DISABLED', undefined, 'paymentMethod');

    const now = new Date();
    const order = await this.prisma.$transaction(
      async (tx) => {
        const customer = await tx.customer.upsert({
          where: { phone: input.phone },
          update: {},
          create: { phone: input.phone, name: input.name, locale },
        });
        if (!customer.name)
          await tx.customer.update({ where: { id: customer.id }, data: { name: input.name } });
        // Serialize checkouts of one customer: promo per-customer/first-order counts are only
        // race-free if two simultaneous orders from the same phone can't interleave.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${customer.id}))`;

        const promo = cart.promoCode
          ? await this.promos.validate(
              cart.promoCode,
              { customerId: customer.id, deviceHash: deviceHash ?? cart.deviceHash, now },
              tx,
            )
          : null;
        const priced = priceCart(
          this.carts.pricingInput(cart, zone, promo?.pricing ?? null, promoRules.maxDiscountPct),
        );
        if (priced.promo?.status === 'rejected')
          throw new DomainError(priced.promo.reason, undefined, 'promoCode');
        if (input.paymentMethod === 'COD' && priced.totalTiyin > soumToTiyin(rules.codMaxSoum)) {
          throw new DomainError('COD_LIMIT_EXCEEDED', undefined, 'paymentMethod');
        }

        const variants = await tx.variant.findMany({
          where: { id: { in: priced.lines.map((l) => l.variantId) } },
          include: { product: { select: { name: true, sellerId: true } } },
        });
        const byId = new Map(variants.map((v) => [v.id, v]));
        for (const v of variants)
          if (!v.ikpu) throw new DomainError('IKPU_MISSING', { sku: v.sku });

        const isCod = input.paymentMethod === 'COD';
        const created = await tx.order.create({
          data: {
            publicId: orderPublicId(),
            trackingToken: trackingToken(),
            customerId: customer.id,
            locale,
            contactName: input.name,
            contactPhone: input.phone,
            address: {
              region: input.region,
              district: input.district ?? null,
              line: input.addressLine,
              lat: input.lat ?? null,
              lng: input.lng ?? null,
            },
            comment: input.comment ?? null,
            subtotalTiyin: priced.subtotalTiyin,
            discountTiyin: priced.discountTiyin,
            shippingTiyin: priced.shippingTiyin ?? 0n,
            totalTiyin: priced.totalTiyin,
            promoCode: priced.promo?.status === 'applied' ? priced.promo.code : null,
            paymentMethod: input.paymentMethod,
            deliveryZone: zone.key,
            carrier: zone.carrier,
            offerVersion: input.offerVersion,
            source: 'web',
            items: {
              create: priced.lines.map((l) => {
                const v = byId.get(l.variantId)!;
                return {
                  variantId: v.id,
                  sellerId: v.product.sellerId,
                  nameSnapshot: {
                    product: v.product.name,
                    variant: v.label,
                  } as Prisma.InputJsonValue,
                  sku: v.sku,
                  ikpu: v.ikpu!,
                  packageCode: v.packageCode,
                  vatPercent: v.vatPercent,
                  qty: l.qty,
                  priceTiyin: l.unitPriceTiyin,
                  discountTiyin: l.discountTiyin,
                };
              }),
            },
            payments: {
              create: {
                method: input.paymentMethod,
                status: isCod ? 'COD_PENDING' : 'PENDING',
                amountTiyin: priced.totalTiyin,
              },
            },
            shipments: {
              create: {
                sellerId: variants[0]!.product.sellerId,
                carrier: zone.carrier,
                priceTiyin: priced.shippingTiyin ?? 0n,
              },
            },
            events: {
              create: {
                type: 'CREATED',
                to: 'NEW',
                actorType: 'CUSTOMER',
                actorId: customer.id,
                data: { paymentMethod: input.paymentMethod, zone: zone.key },
              },
            },
          },
        });

        // Online: 30 min to pay (docs/02); COD: held until the operator confirms or auto-cancel.
        const holdMinutes = isCod ? rules.codAutoCancelHours * 60 : rules.onlineReservationMinutes;
        await this.reservations.reserve(
          tx,
          created.id,
          priced.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
          new Date(now.getTime() + holdMinutes * 60_000),
        );

        if (promo && priced.promo?.status === 'applied') {
          await tx.promoRedemption.create({
            data: {
              promoId: promo.promo.id,
              orderId: created.id,
              customerId: customer.id,
              deviceHash: deviceHash ?? cart.deviceHash,
              discountTiyin: priced.discountTiyin,
            },
          });
        }
        const consents = [
          ...(input.consents.smsMarketing
            ? [
                {
                  customerId: customer.id,
                  channel: 'SMS_MARKETING' as const,
                  granted: true,
                  source: 'checkout',
                },
              ]
            : []),
          ...(input.consents.telegram
            ? [
                {
                  customerId: customer.id,
                  channel: 'TELEGRAM' as const,
                  granted: true,
                  source: 'checkout',
                },
              ]
            : []),
        ];
        if (consents.length) await tx.consent.createMany({ data: consents });
        await tx.cart.update({
          where: { id: cart.id },
          data: { status: 'CONVERTED', customerId: customer.id },
        });
        await tx.customer.update({
          where: { id: customer.id },
          data: { leadSource: customer.leadSource ?? 'checkout', leadAt: customer.leadAt ?? now },
        });
        return created;
      },
      { timeout: 15_000 },
    );

    await this.notifications.orderStatus(order.id, 'order_created');

    if (input.paymentMethod === 'COD') {
      return { orderNumber: order.number, publicId: order.publicId, next: { type: 'cod' } };
    }
    const provider = await this.integrations.payment(
      input.paymentMethod === 'PAYME' ? 'payme' : 'click',
    );
    const url = await provider.createCheckoutUrl({
      orderId: order.publicId,
      orderNumber: order.number,
      amountTiyin: order.totalTiyin,
      returnUrl: `${this.env.APP_URL}/${locale}/buyurtma/${order.publicId}`,
      locale,
    });
    return { orderNumber: order.number, publicId: order.publicId, next: { type: 'redirect', url } };
  }

  /** "Pay again" from the payment-failed screen while the reservation is still alive. */
  async retryPayment(
    publicId: string,
    method: 'PAYME' | 'CLICK',
    locale: Locale,
  ): Promise<{ url: string }> {
    const order = await this.prisma.order.findUnique({
      where: { publicId },
      include: {
        payments: { orderBy: { createdAt: 'desc' } },
        reservations: { where: { releasedAt: null } },
      },
    });
    if (!order) throw new DomainError('ORDER_NOT_FOUND');
    const payment = order.payments.find((p) => p.status === 'PENDING' || p.status === 'FAILED');
    const alive = order.reservations.some((r) => r.expiresAt && r.expiresAt > new Date());
    if (order.status !== 'NEW' || !payment || payment.method === 'COD' || !alive)
      throw new DomainError('PAYMENT_NOT_RETRYABLE');
    if (payment.status !== 'PENDING') assertPaymentTransition(payment.status, 'PENDING');
    await this.prisma.$transaction(async (tx) => {
      // A row already bound to a provider transaction keeps its history (Payme CheckTransaction /
      // GetStatement must still find it by method + id): the retry starts a fresh row instead.
      if (payment.providerTxnId)
        await tx.payment.create({
          data: { orderId: order.id, method, status: 'PENDING', amountTiyin: payment.amountTiyin },
        });
      else
        await tx.payment.update({ where: { id: payment.id }, data: { method, status: 'PENDING' } });
      await tx.order.update({ where: { id: order.id }, data: { paymentMethod: method } });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'PAYMENT_RETRY',
          from: payment.status,
          to: 'PENDING',
          actorType: 'CUSTOMER',
          data: { method },
        },
      });
    });
    const provider = await this.integrations.payment(method === 'PAYME' ? 'payme' : 'click');
    const url = await provider.createCheckoutUrl({
      orderId: order.publicId,
      orderNumber: order.number,
      amountTiyin: order.totalTiyin,
      returnUrl: `${this.env.APP_URL}/${locale}/buyurtma/${order.publicId}`,
      locale,
    });
    return { url };
  }

  /** Display name helper for receipts/notifications. */
  static itemName(snapshot: unknown, locale: Locale): string {
    const s = snapshot as { product?: unknown; variant?: unknown } | null;
    return [t(s?.product, locale), t(s?.variant, locale)].filter(Boolean).join(' · ');
  }
}
