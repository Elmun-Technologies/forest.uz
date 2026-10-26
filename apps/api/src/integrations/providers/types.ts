import type { DeliveryStatus, Locale } from '@forest/contracts';

/**
 * Provider ports. Every integration has a real adapter and a `fake` one; services depend only on
 * these interfaces and get the implementation from IntegrationsService (connected → real, else fake).
 */

export interface ProviderContext {
  /** Decrypted credentials (never logged). */
  credentials: Record<string, string>;
  config: Record<string, unknown>;
  mode: 'fake' | 'sandbox' | 'live';
}

export interface HealthResult {
  ok: boolean;
  message: string;
}

// ── Payments ──
export interface CheckoutInput {
  orderId: string;
  orderNumber: string;
  amountTiyin: bigint;
  returnUrl: string;
  locale: Locale;
}

export interface PaymentProvider {
  readonly key: 'payme' | 'click';
  /** Hosted checkout URL (card data never touches our servers). */
  createCheckoutUrl(input: CheckoutInput): Promise<string>;
}

// ── Delivery ──
export interface DeliveryAddress {
  region: string;
  district?: string | null;
  line: string;
  lat?: number | null;
  lng?: number | null;
}

export interface ShipmentInput {
  orderNumber: string;
  recipientName: string;
  recipientPhone: string;
  address: DeliveryAddress;
  weightGrams: number;
  itemsCount: number;
  codAmountTiyin: bigint | null;
  comment?: string | null;
}

export interface CourierInfo {
  name: string;
  phone: string | null;
  car: string | null;
  plate: string | null;
  etaAt: Date | null;
  distanceKm: number | null;
}

export interface ShipmentState {
  status: DeliveryStatus;
  courier: CourierInfo | null;
  trackNumber: string | null;
  history: { at: Date; status: DeliveryStatus; note: string }[];
}

export interface DeliveryProvider {
  readonly key: 'yandex_delivery' | 'bts';
  quote(
    address: DeliveryAddress,
    weightGrams: number,
  ): Promise<{ priceTiyin: bigint; etaMinutes: number } | null>;
  createShipment(input: ShipmentInput): Promise<{ externalId: string; trackNumber: string | null }>;
  getState(externalId: string): Promise<ShipmentState>;
  cancel(externalId: string): Promise<void>;
}

// ── Messaging ──
export interface SmsProvider {
  readonly key: 'eskiz' | 'playmobile';
  send(input: {
    phone: string;
    text: string;
    templateKey: string;
  }): Promise<{ providerId: string }>;
}

export interface MessengerButton {
  text: string;
  url?: string;
  callbackData?: string;
}

export interface MessengerProvider {
  readonly key: 'telegram';
  sendMessage(input: {
    chatId: string;
    text: string;
    buttons?: MessengerButton[][];
    photoUrl?: string;
  }): Promise<{ messageId: string }>;
}

// ── Fiscal ──
export interface FiscalReceiptInput {
  orderNumber: string;
  paymentId: string;
  items: {
    title: string;
    ikpu: string;
    packageCode: string | null;
    vatPercent: number;
    qty: number;
    priceTiyin: bigint;
  }[];
  totalTiyin: bigint;
  isRefund: boolean;
}

export interface FiscalProvider {
  readonly key: 'fiscal_ofd' | 'manual';
  issueReceipt(input: FiscalReceiptInput): Promise<{ receiptId: string; url: string | null }>;
}

// ── Inventory (MoySklad) ──
export interface InventoryProduct {
  externalId: string;
  sku: string;
  name: string;
  ikpu: string | null;
  priceTiyin: bigint;
  stock: number;
  isBundle: boolean;
}

export interface InventoryProvider {
  readonly key: 'moysklad';
  pullAssortment(): Promise<InventoryProduct[]>;
  pushOrder(input: {
    orderNumber: string;
    phone: string;
    positions: { sku: string; qty: number; priceTiyin: bigint }[];
    reserve: boolean;
  }): Promise<{ externalId: string }>;
  updateOrderState(externalId: string, state: string): Promise<void>;
}

// ── Ads & AI ──
export interface AdSignalEvent {
  eventId: string;
  name: 'PageView' | 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Lead' | 'Purchase';
  at: Date;
  valueTiyin?: bigint;
  hashedPhone?: string;
  clickIds?: Record<string, string>;
  ip?: string | null;
  userAgent?: string | null;
  url?: string;
}

export interface AdSignalProvider {
  readonly key: 'meta_capi' | 'google_ads' | 'tiktok_pixel' | 'yandex_metrika';
  send(events: AdSignalEvent[]): Promise<{ accepted: number }>;
}

export interface AiProvider {
  readonly key: 'claude' | 'openai';
  complete(input: {
    system: string;
    prompt: string;
    maxTokens: number;
  }): Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}
