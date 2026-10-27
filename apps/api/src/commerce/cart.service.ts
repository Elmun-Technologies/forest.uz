import { Injectable } from '@nestjs/common';
import {
  type CartDto,
  type CartLineDto,
  computeDeliveryPromise,
  DomainError,
  type DeliveryOptionDto,
  type DeliveryZone,
  errorMessage,
  formatSoum,
  type Locale,
  pickZone,
  priceCart,
  type PricingInput,
  type PricingResult,
  soumToTiyin,
  t,
  tiyinToSoumInt,
} from '@forest/contracts';
import type { Prisma } from '@forest/db';
import type { Request, Response } from 'express';
import { cartIdFromCookie, SessionService } from '../common/session';
import { cartWeightGrams, DeliveryQuoteService } from '../delivery/delivery-quote.service';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PromoService } from './promo.service';

const cartInclude = {
  items: {
    orderBy: { addedAt: 'asc' },
    include: {
      variant: {
        include: {
          product: {
            include: {
              seller: { select: { name: true, isOfficial: true } },
              images: { include: { file: true }, orderBy: { sort: 'asc' }, take: 1 },
              related: {
                where: { kind: 'UPSELL' },
                orderBy: { sort: 'asc' },
                include: {
                  to: {
                    include: {
                      variants: true,
                      images: { include: { file: true }, orderBy: { sort: 'asc' }, take: 1 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

const MAX_LINES = 30;

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
    private readonly promos: PromoService,
    private readonly quotes: DeliveryQuoteService,
  ) {}

  /** Customer cart when logged in, else the anonymous cookie cart. Never creates rows. */
  async current(req: Request): Promise<CartWithItems | null> {
    const session = await this.sessions.read(req);
    if (session) {
      const cart = await this.prisma.cart.findFirst({
        where: { customerId: session.customerId, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        include: cartInclude,
      });
      if (cart) return cart;
    }
    const id = cartIdFromCookie(req);
    if (!id) return null;
    // A shared browser may still carry another customer's cart cookie: never show or use it.
    return this.prisma.cart.findFirst({
      where: {
        id,
        status: 'ACTIVE',
        ...(session
          ? { OR: [{ customerId: null }, { customerId: session.customerId }] }
          : { customerId: null }),
      },
      include: cartInclude,
    });
  }

  private async currentOrCreate(req: Request, res: Response): Promise<CartWithItems> {
    const existing = await this.current(req);
    if (existing) return existing;
    const session = await this.sessions.read(req);
    const cart = await this.prisma.cart.create({
      data: { customerId: session?.customerId ?? null },
      include: cartInclude,
    });
    this.sessions.setCartCookie(res, cart.id);
    return cart;
  }

  private async reload(id: string): Promise<CartWithItems> {
    return this.prisma.cart.findUniqueOrThrow({ where: { id }, include: cartInclude });
  }

  async addItem(
    req: Request,
    res: Response,
    variantId: string,
    qty: number,
  ): Promise<CartWithItems> {
    const variant = await this.prisma.variant.findUnique({
      where: { id: variantId },
      include: { product: { select: { status: true } } },
    });
    if (!variant || !variant.active || variant.product.status !== 'ACTIVE')
      throw new DomainError('PRODUCT_NOT_FOUND');
    if (variant.stock - variant.reserved <= 0) throw new DomainError('OUT_OF_STOCK');
    const cart = await this.currentOrCreate(req, res);
    const existing = cart.items.find((i) => i.variantId === variantId);
    if (!existing && cart.items.length >= MAX_LINES)
      throw new DomainError('VALIDATION_FAILED', { maxLines: MAX_LINES });
    const nextQty = Math.min(99, (existing?.qty ?? 0) + qty);
    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      update: { qty: nextQty },
      create: { cartId: cart.id, variantId, qty: nextQty },
    });
    await this.prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
    return this.reload(cart.id);
  }

  async setQty(req: Request, variantId: string, qty: number): Promise<CartWithItems | null> {
    const cart = await this.current(req);
    if (!cart) return null;
    if (qty <= 0) await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id, variantId } });
    else
      await this.prisma.cartItem.updateMany({
        where: { cartId: cart.id, variantId },
        data: { qty },
      });
    await this.prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
    return this.reload(cart.id);
  }

  async setPromo(
    req: Request,
    res: Response,
    code: string | null,
    deviceHash: string | null,
  ): Promise<CartWithItems> {
    const cart = await this.currentOrCreate(req, res);
    if (code) {
      // Validate eligibility now so the user gets the precise reason inline (docs/01 cart).
      await this.promos.validate(code, {
        customerId: cart.customerId,
        deviceHash,
        now: new Date(),
      });
    }
    await this.prisma.cart.update({
      where: { id: cart.id },
      data: { promoCode: code, deviceHash },
    });
    return this.reload(cart.id);
  }

  /** Moves anonymous cart items into the customer's active cart after identification. */
  async mergeAnonymousCart(anonCartId: string | null, customerId: string): Promise<void> {
    if (!anonCartId) return;
    await this.prisma.$transaction(async (tx) => {
      const anon = await tx.cart.findFirst({
        where: { id: anonCartId, status: 'ACTIVE' },
        include: { items: true },
      });
      if (!anon || anon.customerId === customerId) {
        if (anon && !anon.customerId)
          await tx.cart.update({ where: { id: anon.id }, data: { customerId } });
        return;
      }
      if (anon.customerId) return; // someone else's cart — never merge across customers
      const target = await tx.cart.findFirst({
        where: { customerId, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
      });
      if (!target) {
        await tx.cart.update({ where: { id: anon.id }, data: { customerId } });
        return;
      }
      for (const item of anon.items) {
        await tx.cartItem.upsert({
          where: { cartId_variantId: { cartId: target.id, variantId: item.variantId } },
          update: { qty: { increment: item.qty } },
          create: { cartId: target.id, variantId: item.variantId, qty: item.qty },
        });
      }
      await tx.cart.update({
        where: { id: target.id },
        data: { promoCode: target.promoCode ?? anon.promoCode, updatedAt: new Date() },
      });
      await tx.cart.update({ where: { id: anon.id }, data: { status: 'MERGED' } });
    });
  }

  /** Pricing input from cart rows; shared with checkout so both price identically. */
  pricingInput(
    cart: CartWithItems,
    zone: DeliveryZone | null,
    promo: PricingInput['promo'],
    maxDiscountPct: number,
  ): PricingInput {
    return {
      lines: cart.items.map((i) => ({
        variantId: i.variantId,
        qty: i.qty,
        unitPriceTiyin: i.variant.priceTiyin,
        compareAtTiyin: i.variant.compareAtTiyin,
        isBundle: i.variant.product.type === 'BUNDLE',
      })),
      promo: promo ?? null,
      shipping: zone
        ? {
            priceTiyin: soumToTiyin(zone.priceSoum),
            freeFromTiyin: zone.freeFromSoum ? soumToTiyin(zone.freeFromSoum) : null,
          }
        : null,
      maxDiscountPct,
    };
  }

  /** Default zone for the cart page estimate: first active zone (Tashkent express). */
  async defaultZone(): Promise<DeliveryZone | null> {
    const zones = await this.settings.get('delivery.zones');
    return zones.filter((z) => z.active).sort((a, b) => a.sort - b.sort)[0] ?? null;
  }

  async zoneByKey(key: string): Promise<DeliveryZone | null> {
    const zones = await this.settings.get('delivery.zones');
    return zones.find((z) => z.key === key && z.active) ?? null;
  }

  async toDto(
    cart: CartWithItems | null,
    locale: Locale,
    zone?: DeliveryZone | null,
  ): Promise<CartDto> {
    if (!cart || cart.items.length === 0) {
      return {
        id: cart?.id ?? null,
        lines: [],
        totals: {
          itemsCount: 0,
          subtotalSoum: 0,
          discountSoum: 0,
          shippingSoum: null,
          totalSoum: 0,
          freeShippingRemainingSoum: null,
          freeShippingThresholdSoum: null,
        },
        promo: null,
        upsell: null,
      };
    }
    const effectiveZone = zone === undefined ? await this.defaultZone() : zone;
    const { maxDiscountPct } = await this.settings.get('promo.rules');

    let promoDto: CartDto['promo'] = null;
    let pricingPromo: PricingInput['promo'] = null;
    if (cart.promoCode) {
      try {
        pricingPromo = (
          await this.promos.validate(cart.promoCode, {
            customerId: cart.customerId,
            deviceHash: cart.deviceHash,
            now: new Date(),
          })
        ).pricing;
      } catch (e) {
        const code = e instanceof DomainError ? e.code : 'PROMO_NOT_FOUND';
        promoDto = {
          code: cart.promoCode,
          status: 'rejected',
          reason: code,
          message: errorMessage(code, locale),
        };
      }
    }
    const priced: PricingResult = priceCart(
      this.pricingInput(cart, effectiveZone, pricingPromo, maxDiscountPct),
    );
    if (priced.promo?.status === 'applied') {
      promoDto = {
        code: priced.promo.code,
        status: 'applied',
        discountSoum: tiyinToSoumInt(priced.promo.discountTiyin),
      };
    } else if (priced.promo?.status === 'rejected') {
      const vars: Record<string, string> =
        priced.promo.reason === 'PROMO_MIN_CART' && pricingPromo
          ? { min: formatSoum(pricingPromo.minCartTiyin, locale) }
          : {};
      promoDto = {
        code: priced.promo.code,
        status: 'rejected',
        reason: priced.promo.reason,
        message: errorMessage(priced.promo.reason, locale, vars),
      };
    }

    const lines: CartLineDto[] = cart.items.map((i) => {
      const v = i.variant;
      const available = Math.max(0, v.stock - v.reserved);
      const img = v.product.images[0];
      return {
        variantId: v.id,
        productId: v.productId,
        productSlug: v.product.slug,
        name: t(v.product.name, locale),
        variantLabel: t(v.label, locale),
        sellerName: v.product.seller.name,
        isOfficialSeller: v.product.seller.isOfficial,
        image: img ? this.files.image(img.file, img.alt ?? v.product.name, locale) : null,
        qty: i.qty,
        unitPriceSoum: tiyinToSoumInt(v.priceTiyin),
        compareAtSoum: v.compareAtTiyin ? tiyinToSoumInt(v.compareAtTiyin) : null,
        lineTotalSoum: tiyinToSoumInt(v.priceTiyin * BigInt(i.qty)),
        available,
        insufficient: i.qty > available,
        isGift: false,
      };
    });
    for (const g of priced.lines.filter((l) => l.isGift)) {
      const v = await this.prisma.variant.findUnique({
        where: { id: g.variantId },
        include: {
          product: { include: { seller: true, images: { include: { file: true }, take: 1 } } },
        },
      });
      if (!v) continue;
      const img = v.product.images[0];
      lines.push({
        variantId: v.id,
        productId: v.productId,
        productSlug: v.product.slug,
        name: t(v.product.name, locale),
        variantLabel: t(v.label, locale),
        sellerName: v.product.seller.name,
        isOfficialSeller: v.product.seller.isOfficial,
        image: img ? this.files.image(img.file, img.alt ?? v.product.name, locale) : null,
        qty: 1,
        unitPriceSoum: 0,
        compareAtSoum: tiyinToSoumInt(v.priceTiyin),
        lineTotalSoum: 0,
        available: Math.max(0, v.stock - v.reserved),
        insufficient: false,
        isGift: true,
      });
    }

    const inCart = new Set(cart.items.map((i) => i.variant.productId));
    let upsell: CartDto['upsell'] = null;
    for (const i of cart.items) {
      const rel = i.variant.product.related.find(
        (r) => !inCart.has(r.toId) && r.to.status === 'ACTIVE',
      );
      const target = rel?.to;
      const variant = target?.variants
        .filter((v) => v.active && v.stock - v.reserved > 0)
        .sort((a, b) => a.sort - b.sort)[0];
      if (target && variant) {
        const img = target.images[0];
        upsell = {
          productSlug: target.slug,
          variantId: variant.id,
          name: t(target.name, locale),
          reason: t(target.shortDesc, locale),
          priceSoum: tiyinToSoumInt(variant.priceTiyin),
          image: img ? this.files.image(img.file, img.alt ?? target.name, locale) : null,
        };
        break;
      }
    }

    return {
      id: cart.id,
      lines,
      totals: {
        itemsCount: cart.items.reduce((n, i) => n + i.qty, 0),
        subtotalSoum: tiyinToSoumInt(priced.subtotalTiyin),
        discountSoum: tiyinToSoumInt(priced.discountTiyin),
        shippingSoum: priced.shippingTiyin === null ? null : tiyinToSoumInt(priced.shippingTiyin),
        totalSoum: tiyinToSoumInt(priced.totalTiyin),
        freeShippingRemainingSoum:
          priced.freeShippingRemainingTiyin === null
            ? null
            : tiyinToSoumInt(priced.freeShippingRemainingTiyin),
        freeShippingThresholdSoum: effectiveZone?.freeFromSoum ?? null,
      },
      promo: promoDto,
      upsell,
    };
  }

  /** Delivery options for a destination, priced against this cart (free thresholds applied). */
  /** A zone priced by the carrier's live quote for this cart and pin (zone price on any miss). */
  async pricedZone(
    zone: DeliveryZone,
    cart: CartWithItems | null,
    pin: { lat: number; lng: number },
  ): Promise<DeliveryZone> {
    const weight = cartWeightGrams(
      (cart?.items ?? []).map((i) => ({ qty: i.qty, weightGrams: i.variant.weightGrams })),
    );
    return this.quotes.priceZone(
      zone,
      { region: '', district: null, line: '', lat: pin.lat, lng: pin.lng },
      weight,
    );
  }

  async quote(
    cart: CartWithItems | null,
    region: string,
    district: string | null,
    locale: Locale,
    now = new Date(),
    pin: { lat: number; lng: number } | null = null,
  ): Promise<DeliveryOptionDto[]> {
    const zones = pickZone(await this.settings.get('delivery.zones'), region, district);
    const { maxDiscountPct } = await this.settings.get('promo.rules');
    const weight = cartWeightGrams(
      (cart?.items ?? []).map((i) => ({ qty: i.qty, weightGrams: i.variant.weightGrams })),
    );
    const out: DeliveryOptionDto[] = [];
    for (const pickedZone of zones) {
      const zone = await this.quotes.priceZone(
        pickedZone,
        { region, district, line: '', lat: pin?.lat ?? null, lng: pin?.lng ?? null },
        weight,
      );
      let shipping = soumToTiyin(zone.priceSoum);
      if (cart && cart.items.length) {
        let promo: PricingInput['promo'] = null;
        if (cart.promoCode) {
          promo = await this.promos
            .validate(cart.promoCode, {
              customerId: cart.customerId,
              deviceHash: cart.deviceHash,
              now,
            })
            .then((r) => r.pricing)
            .catch(() => null);
        }
        shipping =
          priceCart(this.pricingInput(cart, zone, promo, maxDiscountPct)).shippingTiyin ?? shipping;
      }
      const promise = computeDeliveryPromise(now, zone.rule);
      out.push({
        zoneKey: zone.key,
        carrier: zone.carrier,
        name: t(zone.name, locale),
        etaLabel: t(zone.etaLabel, locale),
        priceSoum: tiyinToSoumInt(shipping),
        promiseAt: promise.deadline.toISOString(),
        promiseKind: promise.kind,
      });
    }
    return out;
  }
}
