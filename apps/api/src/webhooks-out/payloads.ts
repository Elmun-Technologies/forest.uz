import {
  tiyinToSoumInt,
  type WebhookCustomerData,
  type WebhookEvent,
  type WebhookOrderData,
  type WebhookReviewData,
} from '@forest/contracts';
import type { Prisma } from '@forest/db';

/**
 * Webhook payloads (CLAUDE.md §6): no PII — no names, phones, address lines, comments or free
 * text. Built when the event is collected (a snapshot of that moment).
 */

export type OrderForWebhook = Prisma.OrderGetPayload<{
  include: { items: true; payments: { select: { status: true; createdAt: true } } };
}>;

const SETTLED = ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'];

function addressPart(address: unknown, key: 'region' | 'district'): string | null {
  if (!address || typeof address !== 'object') return null;
  const v = (address as Record<string, unknown>)[key];
  return typeof v === 'string' && v ? v : null;
}

export function orderData(
  o: OrderForWebhook,
  change?: { from: string | null; to: string | null },
): WebhookOrderData {
  const payments = [...o.payments].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const payment = payments.find((p) => SETTLED.includes(p.status)) ?? payments[0];
  return {
    number: o.number,
    status: o.status,
    paymentMethod: o.paymentMethod,
    paymentStatus: payment?.status ?? null,
    carrier: o.carrier,
    deliveryZone: o.deliveryZone,
    region: addressPart(o.address, 'region'),
    district: addressPart(o.address, 'district'),
    subtotalUzs: tiyinToSoumInt(o.subtotalTiyin),
    discountUzs: tiyinToSoumInt(o.discountTiyin),
    shippingUzs: tiyinToSoumInt(o.shippingTiyin),
    totalUzs: tiyinToSoumInt(o.totalTiyin),
    promoCode: o.promoCode,
    source: o.source,
    locale: o.locale,
    items: o.items.map((i) => ({ sku: i.sku, qty: i.qty, priceUzs: tiyinToSoumInt(i.priceTiyin) })),
    createdAt: o.createdAt.toISOString(),
    ...(change ? { change } : {}),
  };
}

export function customerData(c: {
  publicId: string;
  locale: string;
  leadSource: string | null;
  createdAt: Date;
}): WebhookCustomerData {
  return {
    id: c.publicId,
    locale: c.locale,
    leadSource: c.leadSource,
    createdAt: c.createdAt.toISOString(),
  };
}

export function reviewData(r: {
  id: string;
  rating: number;
  photoFileIds: string[];
  photoConsent: boolean;
  createdAt: Date;
  product: { slug: string };
}): WebhookReviewData {
  return {
    id: r.id,
    productSlug: r.product.slug,
    rating: r.rating,
    hasPhotos: r.photoConsent && r.photoFileIds.length > 0,
    createdAt: r.createdAt.toISOString(),
  };
}

/** OrderEvent row → webhook events it stands for (a status change may also be shipped/…). */
export function orderEventsFor(e: { type: string; to: string | null }): WebhookEvent[] {
  if (e.type === 'CREATED') return ['order.created'];
  if (e.type === 'PAYMENT_PAID') return ['order.paid'];
  if (e.type !== 'STATUS_CHANGED') return [];
  const out: WebhookEvent[] = ['order.status_changed'];
  if (e.to === 'HANDED_TO_COURIER') out.push('order.shipped');
  if (e.to === 'DELIVERED') out.push('order.delivered');
  if (e.to === 'CANCELLED') out.push('order.cancelled');
  return out;
}
