import { DomainError } from './errors';
import { percentOf, roundToSoum, soumToTiyin, sumTiyin, type Tiyin } from './money';

export const PROMO_TYPES = ['PERCENT', 'FIXED', 'FREE_SHIPPING', 'GIFT'] as const;
export type PromoType = (typeof PROMO_TYPES)[number];

export interface PricingLine {
  variantId: string;
  qty: number;
  unitPriceTiyin: Tiyin;
  /** Kits carry their component price as compare-at; their saving is the "kit discount". */
  compareAtTiyin: Tiyin | null;
  isBundle: boolean;
}

export interface PricingPromo {
  code: string;
  type: PromoType;
  /** PERCENT: percent; FIXED: so'm; FREE_SHIPPING/GIFT: ignored. */
  value: number;
  minCartTiyin: Tiyin;
  gift?: { variantId: string; unitPriceTiyin: Tiyin } | null;
}

export interface PricingShipping {
  priceTiyin: Tiyin;
  freeFromTiyin: Tiyin | null;
}

export interface PricingInput {
  lines: readonly PricingLine[];
  promo?: PricingPromo | null;
  shipping?: PricingShipping | null;
  /** Margin guard: total discount (kit + code) may not exceed this share of the compare-at base. */
  maxDiscountPct: number;
}

export interface PricedLine extends PricingLine {
  lineTotalTiyin: Tiyin;
  /** Promo discount allocated to this line (for receipts/OrderItem). */
  discountTiyin: Tiyin;
  isGift: boolean;
}

export type PromoOutcome =
  | { status: 'applied'; code: string; type: PromoType; discountTiyin: Tiyin; capped: boolean }
  | { status: 'rejected'; code: string; reason: 'PROMO_MIN_CART' | 'PROMO_NO_BENEFIT' };

export interface PricingResult {
  lines: PricedLine[];
  /** Sum of line prices before code discount (kits already at kit price). */
  subtotalTiyin: Tiyin;
  /** Savings already inside kit prices (compare-at − price). Informational. */
  bundleSavingsTiyin: Tiyin;
  /** Code discount (includes gift value). */
  discountTiyin: Tiyin;
  shippingTiyin: Tiyin | null;
  /** Amount still needed for free shipping (null when unknown or already free). */
  freeShippingRemainingTiyin: Tiyin | null;
  totalTiyin: Tiyin;
  promo: PromoOutcome | null;
}

function lineTotal(l: Pick<PricingLine, 'unitPriceTiyin' | 'qty'>): Tiyin {
  return l.unitPriceTiyin * BigInt(l.qty);
}

/** Distributes `amount` across lines proportionally to their totals; remainder lands on the largest line. */
export function allocate(amount: Tiyin, weights: readonly Tiyin[]): Tiyin[] {
  const total = sumTiyin(weights);
  if (amount === 0n || total === 0n) return weights.map(() => 0n);
  const shares = weights.map((w) => roundToSoum((amount * w) / total));
  const diff = amount - sumTiyin(shares);
  if (diff !== 0n) {
    let maxIdx = 0;
    weights.forEach((w, i) => {
      if (w > (weights[maxIdx] ?? 0n)) maxIdx = i;
    });
    shares[maxIdx] = (shares[maxIdx] ?? 0n) + diff;
  }
  return shares;
}

/**
 * Cart pricing engine (pure). Rules (docs/02):
 * - codes don't stack with kit discounts: the code is computed on the compare-at base and only the
 *   part exceeding kit savings is granted ("best one applies");
 * - margin guard caps kit + code discount at `maxDiscountPct` of the compare-at base;
 * - free-shipping threshold is checked against the merchandise total after discount.
 */
export function priceCart(input: PricingInput): PricingResult {
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0)
      throw new DomainError('VALIDATION_FAILED', { qty: l.qty });
    if (l.unitPriceTiyin < 0n) throw new DomainError('VALIDATION_FAILED', { price: 'negative' });
  }
  const lines: PricedLine[] = input.lines.map((l) => ({
    ...l,
    lineTotalTiyin: lineTotal(l),
    discountTiyin: 0n,
    isGift: false,
  }));
  const subtotal = sumTiyin(lines.map((l) => l.lineTotalTiyin));
  const base = sumTiyin(
    lines.map((l) =>
      l.isBundle && l.compareAtTiyin && l.compareAtTiyin > l.unitPriceTiyin
        ? l.compareAtTiyin * BigInt(l.qty)
        : l.lineTotalTiyin,
    ),
  );
  const bundleSavings = base - subtotal;
  const guardCap = percentOf(base, input.maxDiscountPct);

  let discount = 0n;
  let freeShipping = false;
  let promo: PromoOutcome | null = null;

  if (input.promo && lines.length > 0) {
    const p = input.promo;
    if (subtotal < p.minCartTiyin) {
      promo = { status: 'rejected', code: p.code, reason: 'PROMO_MIN_CART' };
    } else if (p.type === 'FREE_SHIPPING') {
      freeShipping = true;
      promo = { status: 'applied', code: p.code, type: p.type, discountTiyin: 0n, capped: false };
    } else {
      let raw: Tiyin;
      if (p.type === 'PERCENT') raw = percentOf(base, p.value) - bundleSavings;
      else if (p.type === 'FIXED') raw = soumToTiyin(p.value) - bundleSavings;
      else raw = p.gift ? p.gift.unitPriceTiyin : 0n;
      raw = raw > subtotal ? subtotal : raw;

      if (raw <= 0n) {
        promo = { status: 'rejected', code: p.code, reason: 'PROMO_NO_BENEFIT' };
      } else {
        const room = guardCap - bundleSavings;
        const capped = raw > room;
        discount = roundToSoum(capped ? (room > 0n ? room : 0n) : raw);
        if (discount <= 0n) {
          promo = { status: 'rejected', code: p.code, reason: 'PROMO_NO_BENEFIT' };
          discount = 0n;
        } else {
          if (p.type === 'GIFT' && p.gift) {
            lines.push({
              variantId: p.gift.variantId,
              qty: 1,
              unitPriceTiyin: p.gift.unitPriceTiyin,
              compareAtTiyin: null,
              isBundle: false,
              lineTotalTiyin: p.gift.unitPriceTiyin,
              discountTiyin: discount,
              isGift: true,
            });
          } else {
            const shares = allocate(
              discount,
              lines.map((l) => l.lineTotalTiyin),
            );
            lines.forEach((l, i) => (l.discountTiyin = shares[i] ?? 0n));
          }
          promo = {
            status: 'applied',
            code: p.code,
            type: p.type,
            discountTiyin: discount,
            capped,
          };
        }
      }
    }
  }

  // Gift lines add their price to the subtotal and the same amount to the discount.
  const giftValue = sumTiyin(lines.filter((l) => l.isGift).map((l) => l.lineTotalTiyin));
  const merchandise = subtotal + giftValue - discount;

  let shipping: Tiyin | null = null;
  let freeRemaining: Tiyin | null = null;
  if (input.shipping) {
    const { priceTiyin, freeFromTiyin } = input.shipping;
    const qualifies = freeShipping || (freeFromTiyin !== null && merchandise >= freeFromTiyin);
    shipping = qualifies ? 0n : priceTiyin;
    if (!qualifies && freeFromTiyin !== null) freeRemaining = freeFromTiyin - merchandise;
  }

  return {
    lines,
    subtotalTiyin: subtotal + giftValue,
    bundleSavingsTiyin: bundleSavings,
    discountTiyin: discount,
    shippingTiyin: shipping,
    freeShippingRemainingTiyin: freeRemaining,
    totalTiyin: merchandise + (shipping ?? 0n),
    promo,
  };
}
