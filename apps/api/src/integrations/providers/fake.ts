import { randomUUID } from 'node:crypto';
import { maskUzPhone } from '@forest/contracts';
import type {
  CheckoutInput,
  DeliveryAddress,
  DeliveryProvider,
  FiscalProvider,
  FiscalReceiptInput,
  MessengerProvider,
  PaymentProvider,
  ShipmentInput,
  ShipmentState,
  SmsProvider,
} from './types';

/**
 * Fake providers: used automatically when an integration isn't connected or PROVIDERS_MODE=fake.
 * They never call the network. Sent messages land in FakeOutbox so local dev and e2e tests can
 * read OTP codes and bot messages (exposed via a dev-only endpoint, disabled in production).
 */
export interface OutboxMessage {
  id: string;
  channel: 'sms' | 'telegram';
  to: string;
  text: string;
  templateKey?: string;
  at: Date;
}

export class FakeOutbox {
  private readonly messages: OutboxMessage[] = [];

  push(m: Omit<OutboxMessage, 'id' | 'at'>): OutboxMessage {
    const msg = { ...m, id: randomUUID(), at: new Date() };
    this.messages.unshift(msg);
    this.messages.length = Math.min(this.messages.length, 200);
    return msg;
  }

  list(to?: string): OutboxMessage[] {
    return to ? this.messages.filter((m) => m.to === to) : [...this.messages];
  }

  clear(): void {
    this.messages.length = 0;
  }
}

export class FakePaymentProvider implements PaymentProvider {
  constructor(
    readonly key: 'payme' | 'click',
    private readonly appUrl: string,
  ) {}

  async createCheckoutUrl(input: CheckoutInput): Promise<string> {
    const url = new URL(`/${input.locale}/fake-pay`, this.appUrl);
    url.searchParams.set('provider', this.key);
    url.searchParams.set('order', input.orderId);
    url.searchParams.set('amount', input.amountTiyin.toString());
    url.searchParams.set('return', input.returnUrl);
    return url.toString();
  }
}

export class FakeDeliveryProvider implements DeliveryProvider {
  private readonly shipments = new Map<string, ShipmentState>();
  private seq = 77120000;

  constructor(readonly key: 'yandex_delivery' | 'bts') {}

  async quote(_address: DeliveryAddress, _weightGrams: number) {
    // Null = "use zone price from settings" (same behaviour as live-quote disabled).
    return null;
  }

  async createShipment(_input: ShipmentInput) {
    const prefix = this.key === 'yandex_delivery' ? 'YD' : 'BTS';
    const externalId = `FAKE-${prefix}-${++this.seq}`;
    this.shipments.set(externalId, {
      status: 'CREATED',
      courier: null,
      trackNumber: this.key === 'bts' ? `${this.seq}` : null,
      history: [{ at: new Date(), status: 'CREATED', note: 'fake shipment created' }],
    });
    return { externalId, trackNumber: this.shipments.get(externalId)?.trackNumber ?? null };
  }

  async getState(externalId: string): Promise<ShipmentState> {
    return (
      this.shipments.get(externalId) ?? {
        status: 'NOT_CREATED',
        courier: null,
        trackNumber: null,
        history: [],
      }
    );
  }

  async cancel(externalId: string): Promise<void> {
    this.shipments.delete(externalId);
  }

  /** Test/dev helper: move a fake shipment forward. */
  advance(externalId: string, next: ShipmentState['status']): void {
    const s = this.shipments.get(externalId);
    if (!s) return;
    s.status = next;
    s.history.push({ at: new Date(), status: next, note: 'fake advance' });
    if (next === 'COURIER_ASSIGNED' || next === 'IN_TRANSIT') {
      s.courier = {
        name: 'Test Kuryer',
        phone: '+998901112233',
        car: 'Chevrolet Damas',
        plate: '01 A 123 BC',
        etaAt: new Date(Date.now() + 40 * 60_000),
        distanceKm: 4.2,
      };
    }
  }
}

export class FakeSmsProvider implements SmsProvider {
  readonly key = 'eskiz' as const;

  constructor(
    private readonly outbox: FakeOutbox,
    private readonly log: (msg: string) => void,
  ) {}

  async send(input: { phone: string; text: string; templateKey: string }) {
    const m = this.outbox.push({
      channel: 'sms',
      to: input.phone,
      text: input.text,
      templateKey: input.templateKey,
    });
    // Dev convenience: show SMS in the API console with a masked phone (never the full number).
    this.log(`[fake-sms] ${maskUzPhone(input.phone)} ← ${input.templateKey}`);
    return { providerId: m.id };
  }
}

export class FakeMessengerProvider implements MessengerProvider {
  readonly key = 'telegram' as const;

  constructor(private readonly outbox: FakeOutbox) {}

  async sendMessage(input: { chatId: string; text: string }) {
    const m = this.outbox.push({ channel: 'telegram', to: input.chatId, text: input.text });
    return { messageId: m.id };
  }
}

export class FakeFiscalProvider implements FiscalProvider {
  readonly key = 'manual' as const;

  async issueReceipt(input: FiscalReceiptInput) {
    return { receiptId: `FAKE-RCPT-${input.orderNumber}-${input.isRefund ? 'R' : 'S'}`, url: null };
  }
}

/** MoySklad's fake lives in `moysklad-fake.ts`. */
export { FakeInventoryProvider } from './moysklad-fake';

/** Claude's fake lives in `claude-fake.ts`. */
export { FakeAiProvider } from './claude-fake';
