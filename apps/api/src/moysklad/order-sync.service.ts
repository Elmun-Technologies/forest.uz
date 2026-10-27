import { Injectable } from '@nestjs/common';
import { maskUzPhone, MOYSKLAD_PUSH_STATUSES, type OrderStatus } from '@forest/contracts';
import { Prisma } from '@forest/db';
import { IntegrationsService } from '../integrations/integrations.service';
import type { InventoryItemType, InventoryProvider } from '../integrations/providers/types';
import { PrismaService } from '../prisma/prisma.service';
import { MoyskladLogService } from './moysklad-log.service';
import {
  mappingOf,
  MoyskladSettingsService,
  type MoyskladState,
} from './moysklad-settings.service';
import { discountPercent, orderDescription, pushBackoffMs, stateChangeFor } from './order-plan';

const BATCH = 20;

export interface OrderSyncSummary {
  pushed: number;
  updated: number;
  failed: number;
}

class PushError extends Error {}

/**
 * Site → MoySklad orders (CLAUDE.md §6): pushes confirmed orders as `customerorder` once (link row
 * + lookup by name make retries and duplicate jobs harmless), hands our stock hold over to the
 * MoySklad reserve, then mirrors later status changes as MoySklad states. Callers hold the
 * MoySklad lock; failures back off per order.
 */
@Injectable()
export class OrderSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly settings: MoyskladSettingsService,
    private readonly log: MoyskladLogService,
  ) {}

  async syncDue(state: MoyskladState, now = new Date()): Promise<OrderSyncSummary> {
    const summary: OrderSyncSummary = { pushed: 0, updated: 0, failed: 0 };
    if (!state.settings.flows.orders) return summary;
    const settings = await this.settings.ensurePushSince(state.settings, now);
    const s = { ...state, settings };
    const due = { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] };
    const toPush = await this.prisma.order.findMany({
      where: {
        status: { in: [...MOYSKLAD_PUSH_STATUSES] },
        createdAt: { gte: new Date(settings.pushSince!) },
        OR: [{ moyskladLink: null }, { moyskladLink: { externalId: null, ...due } }],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
      take: BATCH,
    });
    for (const { id } of toPush) {
      const r = await this.push(s, id, now);
      if (r === 'pushed') summary.pushed++;
      if (r === 'failed') summary.failed++;
    }
    if (settings.flows.statuses) {
      const toUpdate = await this.prisma.$queryRaw<{ orderId: string }[]>`
        SELECT l."orderId" FROM "MoyskladOrderLink" l JOIN "Order" o ON o."id" = l."orderId"
        WHERE l."externalId" IS NOT NULL
          AND l."pushedStatus" IS DISTINCT FROM o."status"::text
          AND (l."nextAttemptAt" IS NULL OR l."nextAttemptAt" <= ${now})
        ORDER BY l."updatedAt" ASC LIMIT ${BATCH}`;
      for (const { orderId } of toUpdate) {
        const r = await this.mirrorState(s, orderId, now);
        if (r === 'updated') summary.updated++;
        if (r === 'failed') summary.failed++;
      }
    }
    await this.log.markSynced('orders', now);
    return summary;
  }

  /** MoySklad entity type of a linked id (cached from catalog pulls, else looked up once). */
  private async typeOf(
    provider: InventoryProvider,
    externalId: string,
    state: MoyskladState,
  ): Promise<InventoryItemType> {
    const cached = await this.log.typeOf(externalId);
    if (cached) return cached;
    for (const type of ['product', 'variant', 'bundle'] as const) {
      const found = await provider.getItem(type, externalId, mappingOf(state.settings));
      if (found?.some((i) => i.externalId === externalId && i.type === type)) {
        await this.log.rememberTypes([{ externalId, type }]);
        return type;
      }
    }
    throw new PushError(`MoySklad'da pozitsiya topilmadi (${externalId})`);
  }

  async push(
    state: MoyskladState,
    orderId: string,
    now = new Date(),
  ): Promise<'pushed' | 'skipped' | 'failed'> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { include: { variant: { select: { moyskladId: true, sku: true } } } },
        moyskladLink: true,
      },
    });
    if (order.moyskladLink?.externalId) return 'skipped';
    const { settings } = state;
    try {
      const unlinked = order.items.filter((i) => !i.variant.moyskladId).map((i) => i.sku);
      if (unlinked.length)
        throw new PushError(
          `SKU MoySklad bilan bog'lanmagan: ${unlinked.join(', ').slice(0, 120)}`,
        );
      const provider = await this.integrations.inventory();
      let counterpartyId: string | null = order.moyskladLink?.counterpartyId ?? null;
      let externalId = await provider.findCustomerOrder(order.number);
      if (!externalId) {
        if (!counterpartyId) {
          if (settings.flows.customers) {
            const cp = await provider.findOrCreateCounterparty({
              phone: order.contactPhone,
              name: order.contactName,
            });
            counterpartyId = cp.id;
            if (cp.created)
              await this.log.log(
                'counterparty',
                true,
                `Yangi kontragent ${maskUzPhone(order.contactPhone)} (#${order.number})`,
                { direction: 'OUT' },
              );
          } else counterpartyId = settings.defaultCounterpartyId;
          if (!counterpartyId)
            throw new PushError("Mijozlar oqimi o'chiq va standart kontragent tanlanmagan");
        }
        const positions = [];
        for (const i of order.items)
          positions.push({
            externalId: i.variant.moyskladId!,
            type: await this.typeOf(provider, i.variant.moyskladId!, state),
            qty: i.qty,
            priceTiyin: i.priceTiyin,
            discountPercent: discountPercent(i.priceTiyin, i.qty, i.discountTiyin),
          });
        externalId = await provider.createCustomerOrder({
          name: order.number,
          counterpartyId,
          organizationId: settings.organizationId,
          storeId: settings.storeId,
          stateName: stateChangeFor(order.status, settings).stateName,
          reserve: settings.reserve,
          description: orderDescription(order),
          attribute: settings.deliveryAttribute.trim()
            ? {
                name: settings.deliveryAttribute,
                value: `${order.carrier} · ${order.deliveryZone}`,
              }
            : null,
          positions,
        });
      }
      const handedOver = await this.prisma.$transaction(async (tx) => {
        // Order row first (lock order used by every writer), so a concurrent cancel either ran
        // before us (nothing left to hand over) or waits until the hand-over is committed.
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
        const link = {
          externalId,
          counterpartyId,
          pushedStatus: order.status,
          holdHandedOver: settings.reserve,
          attempts: 0,
          nextAttemptAt: null,
          lastError: null,
        };
        await tx.moyskladOrderLink.upsert({
          where: { orderId },
          update: link,
          create: { orderId, ...link },
        });
        return settings.reserve ? this.handOver(tx, orderId, now) : 0;
      });
      await this.log.log(
        'order',
        true,
        `#${order.number} → MoySklad${settings.reserve ? ", rezerv qo'yildi" : ''}${handedOver ? '' : ''}`,
        { direction: 'OUT' },
      );
      return 'pushed';
    } catch (e) {
      await this.fail(orderId, order.moyskladLink?.attempts ?? 0, e, now, {
        counterpartyId: null,
      });
      await this.log.log('order', false, `#${order.number}: ${errorText(e)}`, { direction: 'OUT' });
      return 'failed';
    }
  }

  /**
   * The MoySklad reserve now holds the goods: our open reservations end and `stock` drops by the
   * same qty (sellable = stock − reserved is unchanged until the next snapshot, which includes the
   * MoySklad reserve). Returns the units handed over.
   */
  private async handOver(
    tx: Prisma.TransactionClient,
    orderId: string,
    now: Date,
  ): Promise<number> {
    const open = await tx.reservation.findMany({ where: { orderId, releasedAt: null } });
    let units = 0;
    for (const r of [...open].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      await tx.$executeRaw`
        UPDATE "Variant"
        SET "reserved" = GREATEST("reserved" - ${r.qty}, 0), "stock" = GREATEST("stock" - ${r.qty}, 0)
        WHERE "id" = ${r.variantId}`;
      units += r.qty;
    }
    if (open.length)
      await tx.reservation.updateMany({
        where: { id: { in: open.map((r) => r.id) }, releasedAt: null },
        data: { releasedAt: now },
      });
    return units;
  }

  async mirrorState(
    state: MoyskladState,
    orderId: string,
    now = new Date(),
  ): Promise<'updated' | 'skipped' | 'failed'> {
    const link = await this.prisma.moyskladOrderLink.findUnique({
      where: { orderId },
      include: { order: { select: { status: true, number: true } } },
    });
    if (!link?.externalId || link.pushedStatus === link.order.status) return 'skipped';
    const status: OrderStatus = link.order.status;
    const change = stateChangeFor(status, state.settings);
    try {
      if (change.stateName || (change.clearReserve && link.holdHandedOver)) {
        const provider = await this.integrations.inventory();
        await provider.updateCustomerOrder(link.externalId, {
          stateName: change.stateName,
          clearReserve: change.clearReserve && link.holdHandedOver,
        });
      }
      // Conditional: a status change during the call is mirrored on the next run.
      await this.prisma.moyskladOrderLink.updateMany({
        where: { orderId, pushedStatus: link.pushedStatus },
        data: { pushedStatus: status, attempts: 0, nextAttemptAt: null, lastError: null },
      });
      if (change.stateName || change.clearReserve)
        await this.log.log(
          'status',
          true,
          `#${link.order.number}: ${change.stateName ? `«${change.stateName}»` : status}${
            change.clearReserve && link.holdHandedOver ? ', rezerv bekor qilindi' : ''
          }`,
          { direction: 'OUT' },
        );
      return 'updated';
    } catch (e) {
      await this.fail(orderId, link.attempts, e, now, {});
      await this.log.log('status', false, `#${link.order.number}: ${errorText(e)}`, {
        direction: 'OUT',
      });
      return 'failed';
    }
  }

  private async fail(
    orderId: string,
    attempts: number,
    e: unknown,
    now: Date,
    create: { counterpartyId?: string | null },
  ): Promise<void> {
    const next = attempts + 1;
    const data = {
      attempts: next,
      nextAttemptAt: new Date(now.getTime() + pushBackoffMs(next)),
      lastError: errorText(e).slice(0, 300),
    };
    await this.prisma.moyskladOrderLink.upsert({
      where: { orderId },
      update: data,
      create: { orderId, ...create, ...data },
    });
  }
}

function errorText(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return `DB: ${e.code}`;
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}
