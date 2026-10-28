import { Injectable } from '@nestjs/common';
import { DomainError, type Locale } from '@forest/contracts';
import type { Request, Response } from 'express';
import { CartService } from '../commerce/cart.service';
import { SessionService } from '../common/session';
import { PrismaService } from '../prisma/prisma.service';
import { CartLinkService } from './cart-link.service';

const MAX_LINES = 30;

export interface CartRestoreResult {
  /** Lines now in the browser's cart from this link. */
  restored: number;
  locale: Locale | null;
  campaign: string | null;
}

/**
 * `POST /v1/cart/restore` (CLAUDE.md §6, 5A): copies a signed link's lines (a cart or explicit
 * lines) into the browser's current cart — session cart, else cookie cart, else a new anonymous
 * cart with `fr_cart`. qty = max(existing, link) so opening the link twice changes nothing.
 * Another customer's cart row is never handed over, only its lines.
 */
@Injectable()
export class CartRestoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly carts: CartService,
    private readonly sessions: SessionService,
    private readonly links: CartLinkService,
  ) {}

  async restore(req: Request, res: Response, token: string): Promise<CartRestoreResult> {
    const payload = this.links.verify(token);
    if (!payload) throw new DomainError('CART_LINK_INVALID');
    const lines = new Map<string, number>();
    if (payload.cartId) {
      const source = await this.prisma.cart.findUnique({
        where: { id: payload.cartId },
        include: { items: true },
      });
      // A converted cart became an order: nothing to bring back.
      if (source?.status === 'ACTIVE') for (const i of source.items) lines.set(i.variantId, i.qty);
    }
    for (const l of payload.lines ?? [])
      lines.set(l.variantId, Math.max(lines.get(l.variantId) ?? 0, l.qty));

    const sellable = lines.size
      ? await this.prisma.variant.findMany({
          where: { id: { in: [...lines.keys()] }, active: true, product: { status: 'ACTIVE' } },
          select: { id: true },
        })
      : [];
    const result = { locale: payload.locale ?? null, campaign: payload.campaign ?? null };
    if (!sellable.length) return { restored: 0, ...result };

    const target = await this.carts.current(req);
    if (!target) {
      const session = await this.sessions.read(req);
      const created = await this.prisma.cart.create({
        data: { customerId: session?.customerId ?? null },
      });
      this.sessions.setCartCookie(res, created.id);
      await this.fill(created.id, [], sellable, lines, payload.promo ?? null, null);
      return { restored: sellable.length, ...result };
    }
    // The link's own cart is already this browser's (its owner is signed in): nothing to copy,
    // and touching it would restart the abandoned-cart episode (keyed by `updatedAt`).
    if (target.id === payload.cartId) return { restored: target.items.length, ...result };
    const restored = await this.fill(
      target.id,
      target.items.map((i) => ({ variantId: i.variantId, qty: i.qty })),
      sellable,
      lines,
      payload.promo ?? null,
      target.promoCode,
    );
    return { restored, ...result };
  }

  private async fill(
    cartId: string,
    existing: { variantId: string; qty: number }[],
    sellable: { id: string }[],
    lines: Map<string, number>,
    promo: string | null,
    currentPromo: string | null,
  ): Promise<number> {
    const have = new Map(existing.map((i) => [i.variantId, i.qty]));
    let count = 0;
    let changed = false;
    await this.prisma.$transaction(async (tx) => {
      for (const v of sellable) {
        const qty = lines.get(v.id) ?? 0;
        if (qty <= 0) continue;
        if (!have.has(v.id) && have.size >= MAX_LINES) continue;
        const next = Math.min(99, Math.max(have.get(v.id) ?? 0, qty));
        count++;
        if (next === have.get(v.id)) continue;
        changed = true;
        await tx.cartItem.upsert({
          where: { cartId_variantId: { cartId, variantId: v.id } },
          update: { qty: next },
          create: { cartId, variantId: v.id, qty: next },
        });
        have.set(v.id, next);
      }
      // The promo is re-validated whenever the cart is priced (an ineligible code shows its reason).
      const setPromo = !!promo && !currentPromo;
      if (changed || setPromo)
        await tx.cart.update({
          where: { id: cartId },
          data: { updatedAt: new Date(), ...(setPromo ? { promoCode: promo } : {}) },
        });
    });
    return count;
  }
}
