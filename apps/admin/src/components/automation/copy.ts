import type { ApiKeyScope, WebhookDeliveryStatus, WebhookEvent } from '@forest/contracts/core';

/** Webhooks / API keys copy (Uzbek, A10). */

export const EVENT_LABEL: Record<WebhookEvent, string> = {
  'order.created': 'Yangi buyurtma',
  'order.paid': "Buyurtma to'landi",
  'order.status_changed': "Buyurtma holati o'zgardi",
  'order.shipped': 'Kuryerga topshirildi',
  'order.delivered': 'Yetkazildi',
  'order.cancelled': 'Bekor qilindi',
  'customer.created': 'Yangi mijoz',
  'review.approved': 'Sharh tasdiqlandi',
};

export const DELIVERY_STATUS: Record<
  WebhookDeliveryStatus,
  { label: string; tone: 'good' | 'warn' | 'critical' }
> = {
  DELIVERED: { label: 'Yetkazildi', tone: 'good' },
  PENDING: { label: 'Navbatda', tone: 'warn' },
  FAILED: { label: 'Xato', tone: 'critical' },
};

export const SCOPE_LABEL: Record<ApiKeyScope, string> = {
  'products:read': "Mahsulotlar (o'qish)",
  'stock:read': "Qoldiq (o'qish)",
};

export const SECRET_ONCE =
  "Bu kalit faqat hozir ko'rsatiladi. Nusxa olib, xavfsiz joyga saqlang — keyin faqat oxirgi 4 belgisi ko'rinadi.";
