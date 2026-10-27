import { randomUUID } from 'node:crypto';
import { bundleStock } from './moysklad';
import type {
  HealthResult,
  InventoryItem,
  InventoryItemType,
  InventoryOrderInput,
  InventoryProvider,
} from './types';

export interface FakeCustomerOrder {
  id: string;
  input: InventoryOrderInput;
  stateName: string | null;
  reserved: boolean;
}

/**
 * In-memory MoySklad for PROVIDERS_MODE=fake (dev, e2e). Starts empty, so a dev "sync now" changes
 * nothing; tests and dev tools may fill `items` / `stock`. Never touches the network.
 */
export class FakeInventoryProvider implements InventoryProvider {
  readonly key = 'moysklad' as const;
  items: InventoryItem[] = [];
  stock = new Map<string, number>();
  readonly orders = new Map<string, FakeCustomerOrder>();
  readonly counterparties = new Map<string, string>();
  readonly webhooks = new Set<string>();

  async test(): Promise<HealthResult> {
    return { ok: true, message: 'fake mode: no external call made' };
  }

  async listAssortment(): Promise<InventoryItem[]> {
    return this.items.map((i) => ({ ...i }));
  }

  async getItem(type: InventoryItemType, externalId: string): Promise<InventoryItem[] | null> {
    const item = this.items.find((i) => i.type === type && i.externalId === externalId);
    if (!item) return null;
    const variants = item.hasVariants
      ? this.items.filter((i) => i.parentExternalId === item.externalId)
      : [];
    return [item, ...variants].map((i) => ({ ...i }));
  }

  async stockLevels(): Promise<Map<string, number>> {
    const out = new Map(this.stock);
    for (const i of this.items)
      if (i.type === 'bundle' && !out.has(i.externalId))
        out.set(i.externalId, bundleStock(i.components, this.stock));
    return out;
  }

  async findCustomerOrder(name: string): Promise<string | null> {
    return [...this.orders.values()].find((o) => o.input.name === name)?.id ?? null;
  }

  async findOrCreateCounterparty(input: { phone: string }) {
    const existing = this.counterparties.get(input.phone);
    if (existing) return { id: existing, created: false };
    const id = randomUUID();
    this.counterparties.set(input.phone, id);
    return { id, created: true };
  }

  async createCustomerOrder(input: InventoryOrderInput): Promise<string> {
    const id = randomUUID();
    this.orders.set(id, { id, input, stateName: input.stateName, reserved: input.reserve });
    return id;
  }

  async updateCustomerOrder(
    externalId: string,
    change: { stateName: string | null; clearReserve: boolean },
  ): Promise<void> {
    const o = this.orders.get(externalId);
    if (!o) return;
    if (change.stateName) o.stateName = change.stateName;
    if (change.clearReserve) o.reserved = false;
  }

  async registerWebhooks(url: string) {
    const existed = this.webhooks.has(url);
    this.webhooks.add(url);
    return existed ? { created: 0, existing: 10 } : { created: 10, existing: 0 };
  }
}
