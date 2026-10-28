import { describe, expect, it } from 'vitest';
import { orderData, orderEventsFor, type OrderForWebhook } from './payloads';

describe('webhook payloads', () => {
  it('maps order events', () => {
    expect(orderEventsFor({ type: 'CREATED', to: null })).toEqual(['order.created']);
    expect(orderEventsFor({ type: 'PAYMENT_PAID', to: 'PAID' })).toEqual(['order.paid']);
    expect(orderEventsFor({ type: 'STATUS_CHANGED', to: 'HANDED_TO_COURIER' })).toEqual([
      'order.status_changed',
      'order.shipped',
    ]);
    expect(orderEventsFor({ type: 'STATUS_CHANGED', to: 'DELIVERED' })).toContain(
      'order.delivered',
    );
    expect(orderEventsFor({ type: 'STATUS_CHANGED', to: 'CANCELLED' })).toContain(
      'order.cancelled',
    );
    expect(orderEventsFor({ type: 'NOTE', to: null })).toEqual([]);
  });

  it('order payload carries no PII', () => {
    const order = {
      number: 'F-10001',
      status: 'CONFIRMED',
      paymentMethod: 'PAYME',
      carrier: 'YANDEX',
      deliveryZone: 'tashkent',
      address: { region: 'tashkent', district: 'yunusobod', line: 'Amir Temur 1, kv 5', lat: 41.3 },
      contactName: 'Aziza Karimova',
      contactPhone: '+998901234567',
      comment: 'call me',
      subtotalTiyin: 50_000_000n,
      discountTiyin: 0n,
      shippingTiyin: 3_000_000n,
      totalTiyin: 53_000_000n,
      promoCode: null,
      source: 'web',
      locale: 'uz',
      createdAt: new Date('2026-10-27T10:00:00Z'),
      items: [{ sku: 'FR-CW-1', qty: 2, priceTiyin: 25_000_000n }],
      payments: [{ status: 'PAID', createdAt: new Date('2026-10-27T10:01:00Z') }],
    } as unknown as OrderForWebhook;
    const data = orderData(order);
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/Aziza|998901234567|Amir Temur|call me|41\.3/);
    expect(data).toMatchObject({
      number: 'F-10001',
      region: 'tashkent',
      district: 'yunusobod',
      totalUzs: 530_000,
      paymentStatus: 'PAID',
      items: [{ sku: 'FR-CW-1', qty: 2, priceUzs: 250_000 }],
    });
  });
});
