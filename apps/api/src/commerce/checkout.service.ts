import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { ConsentsService } from '../customer/common/consents';
import { cartWeightGrams, DeliveryQuoteService } from '../delivery/delivery-quote.service';
import { RateLimiter } from '../customer/common/rate-limit';
import { IntegrationsService } from '../integrations/integrations.service';
import type { PaymentProvider } from '../integrations/providers/types';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CartService } from './cart.service';
import { orderPageUrl, orderPublicId, trackingToken } from './ids';
import { NotificationsService } from './notifications.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { PromoService } from './promo.service';
import { ReservationsService } from './reservations.service';

/**
 * Abuse limits for POST /checkout/orders (docs/05: 10/min per IP). COD orders hold stock for
 * 24 h on a phone nobody verified yet, so open unconfirmed COD orders per phone are capped too.
 */
export const CHECKOUT_POLICY = {
  perIpPerMinute: 10,
  perPhonePerHour: 5,
  openCodOrdersPerPhone: 2,
} as const;

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger('Checkout');

  constructor(
    private readonly prisma: PrismaService,
    private readonly carts: CartService,
    private readonly promos: PromoService,
    private readonly reservations: ReservationsService,
    private readonly settings: SettingsService,
    private readonly integrations: IntegrationsService,
    private readonly notifications: NotificationsService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly limiter: RateLimiter,
    private readonly consents: ConsentsService,
    private readonly quotes: DeliveryQuoteService,
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
    ip: string | null,
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
      // After the replay check: a retried request with the same key must not burn the limits.
      await this.limiter.consume(
        'checkout:ip',
        ip ?? 'unknown',
        CHECKOUT_POLICY.perIpPerMinute,
        60,
        'CHECKOUT_LIMITED',
      );
      await this.limiter.consume(
        'checkout:phone',
        input.phone,
        CHECKOUT_POLICY.perPhonePerHour,
        3600,
        'CHECKOUT_LIMITED',
      );
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
    const pickedZone = pickZone(zones, input.region, input.district).find(
      (z) => z.key === input.zoneKey,
    );
    if (!pickedZone) throw new DomainError('DELIVERY_UNAVAILABLE', undefined, 'zoneKey');
    // Live carrier price where the zone has it on (same cached quote the cart showed).
    const zone = await this.quotes.priceZone(
      pickedZone,
      {
        region: input.region,
        district: input.district ?? null,
        line: input.addressLine,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
      },
      cartWeightGrams(cart.items.map((i) => ({ qty: i.qty, weightGrams: i.variant.weightGrams }))),
    );
    if (input.paymentMethod === 'COD' && !flags.cod)
      throw new DomainError('COD_DISABLED', undefined, 'paymentMethod');
    // Before anything is written: an order we can't take payment for would hold stock and burn
    // the promo with no way for the customer to pay it.
    const provider =
      input.paymentMethod === 'COD' ? null : await this.paymentProvider(input.paymentMethod);

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
        // Claim the cart first: of two concurrent checkouts of one cart only one may convert it
        // (the second waits on the row lock, then matches no ACTIVE row).
        const claimed = await tx.cart.updateMany({
          where: { id: cart.id, status: 'ACTIVE' },
          data: { status: 'CONVERTED', customerId: customer.id },
        });
        if (claimed.count !== 1) throw new DomainError('CART_EMPTY');
        if (input.paymentMethod === 'COD') {
          const open = await tx.order.count({
            where: { customerId: customer.id, status: 'NEW', paymentMethod: 'COD' },
          });
          if (open >= CHECKOUT_POLICY.openCodOrdersPerPhone)
            throw new DomainError('COD_OPEN_ORDERS_LIMIT', undefined, 'paymentMethod');
        }

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
        // Ticked boxes grant; an unticked box is no withdrawal (that happens in the cabinet).
        await this.consents.record(
          tx,
          customer.id,
          {
            ...(input.consents.smsMarketing ? { smsMarketing: true } : {}),
            ...(input.consents.telegram ? { telegram: true } : {}),
          },
          'checkout',
        );
        await tx.customer.update({
          where: { id: customer.id },
          data: { leadSource: customer.leadSource ?? 'checkout', leadAt: customer.leadAt ?? now },
        });
        return created;
      },
      { timeout: 15_000 },
    );

    await this.notifications.orderStatus(order.id, 'order_created');

    if (!provider) {
      return { orderNumber: order.number, publicId: order.publicId, next: { type: 'cod' } };
    }
    const orderPage = this.orderPageUrl(order.publicId, locale);
    let url = orderPage;
    try {
      url = await provider.createCheckoutUrl({
        orderId: order.publicId,
        orderNumber: order.number,
        amountTiyin: order.totalTiyin,
        returnUrl: orderPage,
        locale,
      });
    } catch (e) {
      // The order exists (stock held): send the customer to its page, where "pay again" works.
      this.logger.error(`checkout link for ${order.number} failed: ${String(e)}`);
    }
    return { orderNumber: order.number, publicId: order.publicId, next: { type: 'redirect', url } };
  }

  private orderPageUrl(publicId: string, locale: Locale): string {
    return orderPageUrl(this.env.APP_URL, locale, publicId);
  }

  /** The online provider for a method, or PAYMENT_METHOD_UNAVAILABLE when it isn't connected. */
  private async paymentProvider(method: 'PAYME' | 'CLICK'): Promise<PaymentProvider> {
    try {
      return await this.integrations.payment(method === 'PAYME' ? 'payme' : 'click');
    } catch (e) {
      if (e instanceof DomainError && e.code === 'INTEGRATION_NOT_CONFIGURED')
        throw new DomainError('PAYMENT_METHOD_UNAVAILABLE', { method }, 'paymentMethod');
      throw e;
    }
  }

  /**
   * "Pay again" from the payment-failed screen while the reservation is still alive. One
   * transaction under the order lock (the lock every payment webhook takes first), so a Payme
   * CreateTransaction racing this call either binds its row before we look or sees our method.
   */
  async retryPayment(
    publicId: string,
    method: 'PAYME' | 'CLICK',
    locale: Locale,
  ): Promise<{ url: string }> {
    const found = await this.prisma.order.findUnique({ where: { publicId }, select: { id: true } });
    if (!found) throw new DomainError('ORDER_NOT_FOUND');
    const provider = await this.paymentProvider(method);
    const order = await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.lockOrder(tx, found.id);
      const order = await tx.order.findUniqueOrThrow({
        where: { id: found.id },
        include: {
          payments: { orderBy: { createdAt: 'desc' } },
          reservations: { where: { releasedAt: null } },
        },
      });
      const payment = order.payments.find((p) => p.status === 'PENDING' || p.status === 'FAILED');
      const alive = order.reservations.some((r) => r.expiresAt && r.expiresAt > new Date());
      const paid = order.payments.some((p) => !['PENDING', 'FAILED', 'EXPIRED'].includes(p.status));
      if (order.status !== 'NEW' || order.paymentMethod === 'COD' || !payment || !alive || paid)
        throw new DomainError('PAYMENT_NOT_RETRYABLE');
      // A row already bound to a provider transaction is never modified (Payme CheckTransaction /
      // GetStatement must still find it by method + id): the retry starts a fresh row instead.
      if (payment.providerTxnId)
        await tx.payment.create({
          data: { orderId: order.id, method, status: 'PENDING', amountTiyin: payment.amountTiyin },
        });
      else {
        if (payment.status !== 'PENDING') assertPaymentTransition(payment.status, 'PENDING');
        await tx.payment.update({ where: { id: payment.id }, data: { method, status: 'PENDING' } });
      }
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
      return order;
    });
    const url = await provider.createCheckoutUrl({
      orderId: order.publicId,
      orderNumber: order.number,
      amountTiyin: order.totalTiyin,
      returnUrl: this.orderPageUrl(order.publicId, locale),
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
