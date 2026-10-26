import { Injectable } from '@nestjs/common';
import { DomainError, type PricingPromo } from '@forest/contracts';
import type { Prisma, PromoCode } from '@forest/db';
import { PrismaService } from '../prisma/prisma.service';

export interface PromoContext {
  customerId: string | null;
  deviceHash: string | null;
  now: Date;
}

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Promo eligibility (docs/02 A14). Pricing (stacking, margin guard) is done by `priceCart`;
 * this service answers "may this customer use this code now?". Anonymous carts get a provisional
 * check; checkout re-validates inside the order transaction once the phone is known.
 */
@Injectable()
export class PromoService {
  constructor(private readonly prisma: PrismaService) {}

  async find(code: string, db: Db = this.prisma): Promise<PromoCode | null> {
    return db.promoCode.findUnique({ where: { code: code.trim().toUpperCase() } });
  }

  async validate(
    code: string,
    ctx: PromoContext,
    db: Db = this.prisma,
  ): Promise<{ promo: PromoCode; pricing: PricingPromo }> {
    const promo = await this.find(code, db);
    if (!promo) throw new DomainError('PROMO_NOT_FOUND', undefined, 'promoCode');
    if (!promo.active) throw new DomainError('PROMO_INACTIVE', undefined, 'promoCode');
    if (promo.startsAt && promo.startsAt > ctx.now)
      throw new DomainError('PROMO_NOT_STARTED', undefined, 'promoCode');
    if (promo.endsAt && promo.endsAt < ctx.now)
      throw new DomainError('PROMO_EXPIRED', undefined, 'promoCode');

    if (promo.usageLimit !== null) {
      const used = await db.promoRedemption.count({ where: { promoId: promo.id } });
      if (used >= promo.usageLimit)
        throw new DomainError('PROMO_LIMIT_REACHED', undefined, 'promoCode');
    }
    // First-order rule first: its message is the most useful one for the shopper (Holatlar board).
    if (promo.audience === 'FIRST_ORDER') {
      // One phone AND one device per first-order code (docs/02).
      if (ctx.customerId) {
        const orders = await db.order.count({
          where: { customerId: ctx.customerId, status: { notIn: ['CANCELLED'] } },
        });
        if (orders > 0) throw new DomainError('PROMO_FIRST_ORDER_ONLY', undefined, 'promoCode');
      }
      if (ctx.deviceHash) {
        const byDevice = await db.promoRedemption.count({
          where: { promoId: promo.id, deviceHash: ctx.deviceHash },
        });
        if (byDevice > 0) throw new DomainError('PROMO_ALREADY_USED', undefined, 'promoCode');
      }
    }
    if (ctx.customerId) {
      const byCustomer = await db.promoRedemption.count({
        where: { promoId: promo.id, customerId: ctx.customerId },
      });
      if (byCustomer >= promo.perCustomerLimit)
        throw new DomainError('PROMO_ALREADY_USED', undefined, 'promoCode');
    }
    if (promo.audience === 'SEGMENT') {
      const member =
        ctx.customerId && promo.segmentId
          ? await db.segmentMember.findUnique({
              where: {
                segmentId_customerId: { segmentId: promo.segmentId, customerId: ctx.customerId },
              },
            })
          : null;
      if (!member) throw new DomainError('PROMO_NOT_IN_SEGMENT', undefined, 'promoCode');
    }

    let gift: PricingPromo['gift'] = null;
    if (promo.type === 'GIFT' && promo.giftVariantId) {
      const v = await db.variant.findUnique({ where: { id: promo.giftVariantId } });
      if (v && v.active && v.stock - v.reserved > 0)
        gift = { variantId: v.id, unitPriceTiyin: v.priceTiyin };
    }
    return {
      promo,
      pricing: {
        code: promo.code,
        type: promo.type,
        value: promo.value,
        minCartTiyin: promo.minCartTiyin,
        gift,
      },
    };
  }
}
