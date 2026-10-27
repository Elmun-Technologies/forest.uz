import type {
  AdminOrderActionKey,
  AdminOrderTab,
  AdminTimelineEntryDto,
  Carrier,
  DeliveryStatus,
  OrderStatus,
  OrderStepKey,
  PaymentMethod,
  PaymentStatus,
} from '@forest/contracts/core';

/** A6/A7 copy (Uzbek only, like the rest of the admin — docs/08). */

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: 'Yangi',
  CONFIRMED: 'Tasdiqlandi',
  PACKING: "Yig'ilmoqda",
  READY: "Yig'ildi",
  HANDED_TO_COURIER: "Yo'lda",
  DELIVERED: 'Yetkazildi',
  COMPLETED: 'Yakunlandi',
  CANCELLED: 'Bekor qilingan',
  RETURN_REQUESTED: "Qaytarish so'raldi",
  RETURNED: 'Qaytarildi',
};

export const ORDER_STATUS_TONE: Record<
  OrderStatus,
  'neutral' | 'info' | 'sage' | 'good' | 'critical' | 'warn' | 'light'
> = {
  NEW: 'info',
  CONFIRMED: 'neutral',
  PACKING: 'neutral',
  READY: 'neutral',
  HANDED_TO_COURIER: 'sage',
  DELIVERED: 'good',
  COMPLETED: 'good',
  CANCELLED: 'light',
  RETURN_REQUESTED: 'warn',
  RETURNED: 'warn',
};

export const STEP_LABEL: Record<OrderStepKey, string> = {
  NEW: 'Qabul qilindi',
  CONFIRMED: 'Tasdiqlandi',
  PACKING: "Yig'ilmoqda",
  READY: "Yig'ildi",
  HANDED_TO_COURIER: "Yo'lda",
  DELIVERED: 'Yetkazildi',
  COMPLETED: 'Yakunlandi',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: 'Kutilmoqda',
  COD_PENDING: 'Qabulda',
  PAID: "To'langan",
  FAILED: 'Xato',
  EXPIRED: "Muddati o'tdi",
  REFUNDED: 'Qaytarildi',
  PARTIALLY_REFUNDED: 'Qisman qaytarildi',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  PAYME: 'Payme',
  CLICK: 'Click',
  COD: 'Naqd',
};

export const CARRIER_LABEL: Record<Carrier, string> = {
  YANDEX: 'Yandex Dostavka',
  BTS: 'BTS',
  PICKUP: 'Olib ketish',
};

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  NOT_CREATED: 'Kuryer chaqirilmagan',
  CREATED: 'Yaratildi',
  COURIER_ASSIGNED: 'Kuryer biriktirildi',
  PICKED_UP: 'Kuryer oldi',
  IN_TRANSIT: "Yo'lda",
  AT_BRANCH: 'Filialda',
  DELIVERED: 'Yetkazildi',
  FAILED: "Yetkazib bo'lmadi",
  RETURNED: 'Omborga qaytdi',
};

export const SOURCE_LABEL: Record<string, string> = {
  web: 'Sayt',
  bot: 'Telegram bot',
  phone: 'Telefon',
  admin: 'Admin',
};

export const TAB_LABEL: Record<AdminOrderTab, string> = {
  all: 'Hammasi',
  confirm: 'Tasdiqlash kerak',
  awaiting_payment: "To'lov kutilmoqda",
  to_pack: "Yig'ish",
  in_transit: "Yo'lda",
  sla_risk: 'Kechikmoqda',
  delivered: 'Yetkazildi',
  returns: 'Qaytarish',
  cancelled: 'Bekor',
};

export const ACTION_LABEL: Record<AdminOrderActionKey, string> = {
  confirm_cod: 'Buyurtmani tasdiqlash',
  cod_settled: 'Naqd pul olindi',
  start_packing: "Yig'ishni boshlash",
  mark_ready: "Yig'ildi — tayyor",
  yandex_create_claim: 'Yandex narxini olish',
  yandex_accept_claim: 'Kuryer chaqirish',
  yandex_cancel_claim: 'Kuryerni bekor qilish',
  yandex_refresh: 'Holatni yangilash',
  yandex_mark_returned: 'Posilka omborga qaytdi',
  bts_update: 'BTS holatini kiritish',
  mark_delivered: 'Mijoz olib ketdi',
  record_receipt: 'Fiskal chekni kiritish',
  complete: 'Buyurtmani yakunlash',
  cancel: 'Bekor qilish',
  refund: 'Pulni qaytarish',
  add_note: "Izoh qo'shish",
  reveal_pii: "To'liq ko'rsatish",
};

/** Why a visible action is disabled (server error codes → short operator hints). */
export const BLOCKED_HINT: Record<string, string> = {
  FISCAL_RECEIPT_REQUIRED: 'Avval fiskal chekni kiriting.',
  DELIVERY_IN_PROGRESS: "Kuryer yo'lda: avval Yandex buyurtmasini bekor qiling.",
  ORDER_PAID_REFUND_FIRST: "To'langan: bekor qilish uchun pulni to'liq qaytaring.",
  REFUND_VIA_PROVIDER_CABINET:
    "Payme to'lovi Payme kabinetida qaytariladi (Kassa → Tranzaksiyalar → Bekor qilish); natija bu yerda avtomatik ko'rinadi.",
  DELIVERY_CLAIM_NOT_READY: 'Yandex hali narxni hisoblayapti — «Holatni yangilash» ni bosing.',
};

const ACTOR_LABEL: Record<string, string> = {
  CUSTOMER: 'Mijoz',
  SYSTEM: 'Tizim',
  CARRIER: 'Yetkazuvchi',
  PAYMENT_PROVIDER: "To'lov tizimi",
  BOT: 'Bot',
};

export function actorLabel(e: AdminTimelineEntryDto): string {
  if (e.actor.type === 'STAFF') return e.actor.name ?? 'Xodim';
  if (e.actor.type === 'CARRIER' && e.actor.name)
    return e.actor.name === 'yandex_delivery' ? 'Yandex' : e.actor.name;
  if (e.actor.type === 'PAYMENT_PROVIDER' && e.actor.name) return e.actor.name;
  return ACTOR_LABEL[e.actor.type] ?? e.actor.type;
}

const TEMPLATE_LABEL: Record<string, string> = {
  order_created: 'buyurtma qabul qilindi',
  order_confirmed: 'tasdiqlandi',
  order_paid: "to'lov qabul qilindi",
  payment_reminder: "to'lov eslatmasi",
  order_courier: "kuryer yo'lda",
  order_shipped: "yo'lda",
  order_shipped_bts: 'BTS trek raqami',
  order_at_branch: 'filialda',
  order_delivered: 'yetkazildi',
  order_delivery_failed: "yetkazib bo'lmadi",
};

const isOrderStatus = (v: string | null): v is OrderStatus => v !== null && v in ORDER_STATUS_LABEL;
const isPaymentStatus = (v: string | null): v is PaymentStatus =>
  v !== null && v in PAYMENT_STATUS_LABEL;
const isDeliveryStatus = (v: string | null): v is DeliveryStatus =>
  v !== null && v in DELIVERY_STATUS_LABEL;

/** System log line for an OrderEvent (design "Tizim jurnali"). */
export function eventText(e: AdminTimelineEntryDto): string {
  const d = e.data;
  switch (e.type) {
    case 'CREATED':
      return `Buyurtma yaratildi · ${SOURCE_LABEL[String(d.source ?? 'web')] ?? d.source}`;
    case 'STATUS_CHANGED': {
      const to = isOrderStatus(e.to) ? ORDER_STATUS_LABEL[e.to] : e.to;
      const reason = d.reason ? ` (${String(d.reason)})` : '';
      return `Holat: ${to}${reason}`;
    }
    case 'PAYMENT_ATTEMPT':
    case 'PAYMENT_RETRY':
      return `To'lov urinish · ${String(d.method ?? '')}`;
    case 'PAYMENT_REMINDER':
      return "To'lov eslatmasi yuborildi";
    case 'DELIVERY_CLAIM_CREATED':
      return 'Yandex: narx olindi, kuryer hali chaqirilmagan';
    case 'DELIVERY_ACCEPTED':
      return 'Yandex: kuryer chaqirildi';
    case 'DELIVERY_CANCELLED':
      return d.paidAllowed
        ? 'Yandex: kuryer bekor qilindi (pullik)'
        : 'Yandex: kuryer bekor qilindi';
    case 'DELIVERY_STATUS': {
      const to = isDeliveryStatus(e.to) ? DELIVERY_STATUS_LABEL[e.to] : e.to;
      return `Yetkazish: ${to}${d.trackNumber ? ` · ${String(d.trackNumber)}` : ''}`;
    }
    case 'DELIVERY_NOTICE':
      return `Mijozga xabar: ${TEMPLATE_LABEL[String(d.template)] ?? String(d.template)}`;
    case 'DELIVERY_NEEDS_ATTENTION':
      return 'Diqqat: posilka holatini tekshiring';
    case 'FISCAL_RECEIPT':
      return `Fiskal chek ${d.corrected ? 'tuzatildi' : 'kiritildi'}${d.receiptNumber ? ` · ${String(d.receiptNumber)}` : ''}`;
    case 'NOTE':
      return 'Ichki izoh';
    case 'NOTIFICATION_SENT':
      return `Mijozga ${String(d.channel ?? 'SMS')} yuborildi${d.template ? ` · ${TEMPLATE_LABEL[String(d.template)] ?? String(d.template)}` : ''}`;
    default:
      if (e.type.startsWith('PAYMENT_') && isPaymentStatus(e.to))
        return `To'lov: ${PAYMENT_STATUS_LABEL[e.to]}`;
      return e.type;
  }
}
