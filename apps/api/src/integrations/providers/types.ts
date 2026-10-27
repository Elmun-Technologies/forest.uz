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
  /** Provider idempotency token (Yandex `request_id`): same key → same shipment on retry. */
  idempotencyKey?: string;
  items?: {
    title: string;
    sku: string;
    qty: number;
    unitPriceTiyin: bigint;
    weightGrams: number | null;
  }[];
}

export interface CourierInfo {
  name: string;
  phone: string | null;
  car: string | null;
  plate: string | null;
  etaAt: Date | null;
  distanceKm: number | null;
  /** Forwarded numbers (Yandex) come with an extension and expire. */
  phoneExt?: string | null;
  phoneExpiresAt?: Date | null;
  transport?: string | null;
}

export interface ShipmentState {
  status: DeliveryStatus;
  courier: CourierInfo | null;
  trackNumber: string | null;
  history: { at: Date; status: DeliveryStatus; note: string }[];
  /** Raw carrier status (e.g. Yandex `pickuped`) and whether our mapping knows it. */
  providerStatus?: string;
  knownStatus?: boolean;
  /** Carrier's last-change time: older answers than the stored one are ignored. */
  updatedAt?: Date | null;
  version?: number;
  /** The carrier will never change this shipment again (polling stops). */
  terminal?: boolean;
  carrierPriceTiyin?: bigint | null;
  errors?: string[];
}

export interface DeliveryProvider {
  readonly key: 'yandex_delivery' | 'bts';
  quote(
    address: DeliveryAddress,
    weightGrams: number,
  ): Promise<{ priceTiyin: bigint; etaMinutes: number } | null>;
  createShipment(input: ShipmentInput): Promise<{ externalId: string; trackNumber: string | null }>;
  getState(externalId: string, opts?: { withPhone?: boolean }): Promise<ShipmentState>;
  /** Two-step carriers (Yandex): confirm the estimated shipment — dispatches the courier. */
  accept?(externalId: string, version?: number): Promise<void>;
  cancel(externalId: string, opts?: { allowPaid?: boolean }): Promise<void>;
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
  /** Null: no automatic receipt — the operator records it (`manual` provider). */
  issueReceipt(
    input: FiscalReceiptInput,
  ): Promise<{ receiptId: string; url: string | null } | null>;
}

// ── Inventory (MoySklad) ──
export type InventoryItemType = 'product' | 'variant' | 'bundle';

/** One MoySklad assortment entry as the sync needs it (adapter: `moysklad.ts`). */
export interface InventoryItem {
  externalId: string;
  type: InventoryItemType;
  /** Variant → its product's id; null otherwise. */
  parentExternalId: string | null;
  name: string;
  /** `article` (product/bundle) or `code` (variant); null when empty. */
  sku: string | null;
  /** Raw value of the configured IKPU attribute (variants inherit their product's). */
  ikpu: string | null;
  /** Configured price type, tiyin; null when there is no usable price (absent, ≤ 0, not UZS). */
  priceTiyin: bigint | null;
  /** ISO code of that price's currency when it is known and not UZS (price then unusable). */
  priceCurrency: string | null;
  archived: boolean;
  /** A product with modifications is sold through its variants, never itself. */
  hasVariants: boolean;
  /** Variant characteristic values ("1 л, Oq"); null for products. */
  label: string | null;
  /** Bundle composition (assortment id + quantity per kit). */
  components: { externalId: string; qty: number }[];
}

/** What the sync maps from settings (price type and IKPU attribute are per account). */
export interface InventoryMapping {
  priceType: string;
  ikpuAttribute: string;
}

export interface InventoryOrderInput {
  /** Our order number (`customerorder.name`) — also the idempotency lookup key. */
  name: string;
  counterpartyId: string;
  organizationId: string | null;
  storeId: string | null;
  stateName: string | null;
  reserve: boolean;
  description: string;
  attribute: { name: string; value: string } | null;
  positions: {
    externalId: string;
    type: InventoryItemType;
    qty: number;
    priceTiyin: bigint;
    discountPercent: number;
  }[];
}

export interface InventoryProvider {
  readonly key: 'moysklad';
  test(mapping?: InventoryMapping): Promise<HealthResult>;
  /** Every product, variant and bundle (archived ones included when the API returns them). */
  listAssortment(mapping: InventoryMapping): Promise<InventoryItem[]>;
  /** One entity; null when it no longer exists (deleted). Variants of a product come along. */
  getItem(
    type: InventoryItemType,
    externalId: string,
    mapping: InventoryMapping,
  ): Promise<InventoryItem[] | null>;
  /** Free stock (stock − reserve) per assortment id at a store (null = all stores). */
  stockLevels(storeId: string | null): Promise<Map<string, number>>;
  findCustomerOrder(name: string): Promise<string | null>;
  findOrCreateCounterparty(input: {
    phone: string;
    name: string;
  }): Promise<{ id: string; created: boolean }>;
  createCustomerOrder(input: InventoryOrderInput): Promise<string>;
  updateCustomerOrder(
    externalId: string,
    change: { stateName: string | null; clearReserve: boolean },
  ): Promise<void>;
  /** Registers our entity + stock webhooks (idempotent). */
  registerWebhooks(
    url: string,
    opts: { byStore: boolean },
  ): Promise<{ created: number; existing: number }>;
}

// ── Ads & AI ── (ad platform ports: `ads/types.ts`)
export interface AiCompletion {
  /** With `schema`: the JSON document (already a string, parse it). */
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Model that produced the answer (a refusal fallback may differ from the requested one). */
  model: string;
  /** The answer is a refusal or was cut off: no usable draft. */
  stopped: 'refusal' | 'max_tokens' | null;
}

export interface AiProvider {
  readonly key: 'claude' | 'openai';
  readonly fake: boolean;
  complete(input: {
    system: string;
    prompt: string;
    maxTokens: number;
    /** JSON schema of the answer (structured output). */
    schema?: Record<string, unknown>;
  }): Promise<AiCompletion>;
}
