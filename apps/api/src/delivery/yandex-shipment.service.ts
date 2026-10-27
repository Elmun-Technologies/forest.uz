import { Injectable, Logger } from '@nestjs/common';
import {
  canTransitionDelivery,
  type DeliveryStatus,
  DomainError,
  formatTashkentHm,
  type OrderStatus,
  t,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { NotificationsService } from '../commerce/notifications.service';
import {
  type Actor,
  OrderLifecycleService,
  type TxHook,
} from '../commerce/order-lifecycle.service';
import { IntegrationsService } from '../integrations/integrations.service';
import type {
  CourierInfo,
  DeliveryProvider,
  ShipmentInput,
  ShipmentState,
} from '../integrations/providers/types';
import {
  YandexApiError,
  YandexDeliveryProvider,
  yandexParcelOutFailed,
} from '../integrations/providers/yandex-delivery';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_ITEM_WEIGHT_GRAMS } from './delivery-quote.service';
import {
  type AcceptRequest,
  acceptPending,
  readAcceptRequest,
  yandexClaimDead,
} from './shipment-state';

type Tx = Prisma.TransactionClient;

const CARRIER_ACTOR: Actor = { type: 'CARRIER', id: 'yandex_delivery' };
/** Orders a courier may be called for: confirmed (paid / operator-confirmed) and not yet shipped. */
const CLAIMABLE: readonly OrderStatus[] = ['CONFIRMED', 'PACKING', 'READY'];
/** Claim statuses before acceptance; anything else means it was accepted (here or in the cabinet). */
const PRE_ACCEPT = ['new', 'estimating', 'ready_for_approval'];
/** Carrier statuses at which the parcel is on its way (the "shipped / courier" SMS moment). */
const ON_THE_WAY: readonly DeliveryStatus[] = ['PICKED_UP', 'IN_TRANSIT', 'AT_BRANCH'];
/** A CANCELLED order's parcel must never reach these: somebody has to look at it. */
const PARCEL_MOVED: readonly DeliveryStatus[] = [
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_BRANCH',
  'DELIVERED',
  'RETURNED',
];

/** Polling cadence (CLAUDE.md §6); the lease keeps overlapping job runs off the same shipment. */
export const SYNC_POLICY = {
  activeMs: 60_000,
  awaitingAcceptMs: 5 * 60_000,
  /** A claim never accepted is not polled after this (no documented offer-expiry field). */
  stopAwaitingAfterMs: 24 * 3600_000,
  leaseMs: 2 * 60_000,
  maxBackoffMs: 30 * 60_000,
  batch: 50,
} as const;

export function syncBackoffMs(failures: number): number {
  return Math.min(SYNC_POLICY.activeMs * 2 ** Math.max(0, failures - 1), SYNC_POLICY.maxBackoffMs);
}

/** Yandex bookkeeping in `Shipment.providerData`. */
export interface YandexShipmentData {
  /** request_id counter: every new claim attempt gets `<shipmentId>-<seq>`. */
  seq: number;
  /** Minted but not yet confirmed by Yandex: reused by the next create (retry / crash). */
  pendingRequestId: string | null;
  requestIds: string[];
  claimIds: string[];
  version: number | null;
  /** ISO of the claim's `updated_ts` last applied (older answers are ignored). */
  updatedTs: string | null;
  costTiyin: string | null;
  errors: string[];
  /** ISO time the current claim was created (polling of an un-accepted claim stops 24 h later). */
  claimCreatedAt: string | null;
  /** Staff accept in flight (see `acceptClaim`). */
  acceptRequest: AcceptRequest | null;
}

function readData(raw: unknown): YandexShipmentData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<YandexShipmentData>;
  return {
    seq: typeof d.seq === 'number' ? d.seq : 0,
    pendingRequestId: typeof d.pendingRequestId === 'string' ? d.pendingRequestId : null,
    requestIds: Array.isArray(d.requestIds) ? d.requestIds : [],
    claimIds: Array.isArray(d.claimIds) ? d.claimIds : [],
    version: typeof d.version === 'number' ? d.version : null,
    updatedTs: typeof d.updatedTs === 'string' ? d.updatedTs : null,
    costTiyin: typeof d.costTiyin === 'string' ? d.costTiyin : null,
    errors: Array.isArray(d.errors) ? d.errors : [],
    claimCreatedAt: typeof d.claimCreatedAt === 'string' ? d.claimCreatedAt : null,
    acceptRequest: readAcceptRequest(raw),
  };
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Stored courier JSON (`Shipment.courier`): dates as ISO strings. */
export interface StoredCourier {
  name: string;
  phone: string | null;
  phoneExt: string | null;
  phoneExpiresAt: string | null;
  car: string | null;
  plate: string | null;
  transport: string | null;
  etaAt: string | null;
  distanceKm: number | null;
}

export interface StoredHistoryEntry {
  at: string;
  status: DeliveryStatus;
  providerStatus: string | null;
  place: string;
  note: string;
}

function phoneValid(c: StoredCourier | null, now: Date): boolean {
  return Boolean(
    c?.phone &&
    (!c.phoneExpiresAt || new Date(c.phoneExpiresAt).getTime() > now.getTime() + 60_000),
  );
}

export function mergeCourier(
  prev: StoredCourier | null,
  next: CourierInfo | null,
  now: Date,
): StoredCourier | null {
  if (!next) return prev;
  // Another courier took the claim: the old forwarded number and ETA belong to someone else.
  const samePerformer = Boolean(prev && prev.name === next.name && prev.plate === next.plate);
  const keepPhone = !next.phone && samePerformer && phoneValid(prev, now);
  return {
    name: next.name,
    phone: keepPhone ? prev!.phone : next.phone,
    phoneExt: keepPhone ? prev!.phoneExt : (next.phoneExt ?? null),
    phoneExpiresAt: keepPhone ? prev!.phoneExpiresAt : (next.phoneExpiresAt?.toISOString() ?? null),
    car: next.car,
    plate: next.plate,
    transport: next.transport ?? null,
    etaAt: next.etaAt?.toISOString() ?? (samePerformer ? (prev?.etaAt ?? null) : null),
    distanceKm: next.distanceKm,
  };
}

function toDomainError(e: unknown): DomainError {
  if (e instanceof DomainError) return e;
  if (e instanceof YandexApiError)
    return new DomainError('DELIVERY_PROVIDER_ERROR', { status: e.status, code: e.code });
  return new DomainError('DELIVERY_PROVIDER_ERROR', { reason: String(e).slice(0, 200) });
}

export interface ShipmentSummary {
  shipmentId: string;
  orderId: string;
  claimId: string | null;
  status: DeliveryStatus;
  providerStatus: string | null;
  acceptedAt: string | null;
}

type Notice = { template: string; vars?: Record<string, string> };

/**
 * Yandex claim lifecycle for an order's shipment: create (estimate) → staff accept (dispatch) →
 * status sync (poll/callback) → cancel. Order status changes only through OrderLifecycleService;
 * every status change and notification is decided under the order → shipment row locks, so
 * concurrent syncs apply each Yandex status once. Admin (Phase 3 "Kuryer chaqirish") calls the
 * public methods; RBAC is the controller's job.
 */
@Injectable()
export class YandexShipmentService {
  private readonly logger = new Logger('YandexShipments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly notifications: NotificationsService,
  ) {}

  private provider(): Promise<DeliveryProvider> {
    return this.integrations.delivery('yandex_delivery');
  }

  private async lockShipment(tx: Tx, shipmentId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${shipmentId} FOR UPDATE`;
  }

  /** Locks order → shipment (the order-first lock order used by every writer). */
  private async lockBoth(tx: Tx, shipmentId: string) {
    const { orderId } = await tx.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { orderId: true },
    });
    await this.lifecycle.lockOrder(tx, orderId);
    await this.lockShipment(tx, shipmentId);
    return tx.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      include: { order: { select: { id: true, status: true } } },
    });
  }

  private summary(s: {
    id: string;
    orderId: string;
    externalId: string | null;
    status: DeliveryStatus;
    providerStatus: string | null;
    acceptedAt: Date | null;
  }): ShipmentSummary {
    return {
      shipmentId: s.id,
      orderId: s.orderId,
      claimId: s.externalId,
      status: s.status,
      providerStatus: s.providerStatus,
      acceptedAt: s.acceptedAt?.toISOString() ?? null,
    };
  }

  async shipmentForOrder(orderId: string) {
    return this.prisma.shipment.findFirst({ where: { orderId, carrier: 'YANDEX' } });
  }

  /**
   * Creates (or returns) the order's Yandex claim. The claim is only estimated — no courier is
   * dispatched until `acceptClaim`. Idempotent: the request_id is persisted before the call, so a
   * retry after a timeout or crash returns the same claim from Yandex.
   */
  async createClaim(orderId: string, actor: Actor, audit?: TxHook): Promise<ShipmentSummary> {
    const provider = await this.provider();
    const yandex = provider instanceof YandexDeliveryProvider ? provider : null;

    const prepared = await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.lockOrder(tx, orderId);
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          items: { include: { variant: { select: { weightGrams: true } } } },
          shipments: { where: { carrier: 'YANDEX' } },
        },
      });
      if (order.carrier !== 'YANDEX') throw new DomainError('SHIPMENT_CARRIER_MISMATCH');
      if (!CLAIMABLE.includes(order.status))
        throw new DomainError('SHIPMENT_ORDER_NOT_READY', { status: order.status });
      if (order.paymentMethod === 'COD' && yandex && !yandex.config.allowCod)
        throw new DomainError('DELIVERY_COD_UNSUPPORTED');
      let shipment = order.shipments[0];
      if (!shipment) {
        const sellerId = order.items[0]?.sellerId;
        if (!sellerId) throw new DomainError('SHIPMENT_ORDER_NOT_READY');
        shipment = await tx.shipment.create({
          data: { orderId, sellerId, carrier: 'YANDEX', priceTiyin: order.shippingTiyin },
        });
      }
      await this.lockShipment(tx, shipment.id);
      shipment = await tx.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      if (!yandexClaimDead(shipment)) return { existing: shipment, order, requestId: null };
      const data = readData(shipment.providerData);
      let requestId = data.pendingRequestId;
      if (!requestId) {
        data.seq += 1;
        requestId = `${shipment.id}-${data.seq}`;
        data.pendingRequestId = requestId;
        await tx.shipment.update({
          where: { id: shipment.id },
          data: { providerData: json(data) },
        });
      }
      return { existing: null, shipment, order, requestId };
    });
    if (prepared.existing) return this.summary(prepared.existing);
    const { shipment, order, requestId } = prepared;
    if (!shipment || !requestId) throw new DomainError('INTERNAL');

    const address = order.address as {
      region: string;
      district?: string | null;
      line: string;
      lat?: number | null;
      lng?: number | null;
    };
    const input: ShipmentInput = {
      orderNumber: order.number,
      recipientName: order.contactName,
      recipientPhone: order.contactPhone,
      address,
      weightGrams: order.items.reduce(
        (sum, i) => sum + i.qty * (i.variant.weightGrams ?? DEFAULT_ITEM_WEIGHT_GRAMS),
        0,
      ),
      itemsCount: order.items.reduce((sum, i) => sum + i.qty, 0),
      codAmountTiyin: order.paymentMethod === 'COD' ? order.totalTiyin : null,
      comment: order.comment,
      idempotencyKey: requestId,
      items: order.items.map((i) => {
        const snap = i.nameSnapshot as { product?: unknown; variant?: unknown };
        // Couriers read Russian; the SKU travels as extra_id.
        const title = [t(snap.product, 'ru'), t(snap.variant, 'ru')].filter(Boolean).join(', ');
        return {
          title: title || i.sku,
          sku: i.sku,
          qty: i.qty,
          unitPriceTiyin: i.priceTiyin,
          weightGrams: i.variant.weightGrams,
        };
      }),
    };

    let externalId: string;
    try {
      ({ externalId } = await provider.createShipment(input));
    } catch (e) {
      // A definitive rejection (4xx) created nothing: the next attempt mints a new request_id.
      // Timeouts / 5xx keep the pending id, so the retry gets the same claim if one was made.
      if (e instanceof YandexApiError && e.status >= 400 && e.status < 500) {
        await this.prisma.$transaction(async (tx) => {
          await this.lockShipment(tx, shipment.id);
          const s = await tx.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
          const data = readData(s.providerData);
          if (data.pendingRequestId === requestId) data.pendingRequestId = null;
          await tx.shipment.update({ where: { id: s.id }, data: { providerData: json(data) } });
        });
      }
      throw toDomainError(e);
    }

    const now = new Date();
    const saved = await this.prisma.$transaction(async (tx) => {
      const s = await this.lockBoth(tx, shipment.id);
      if (s.externalId === externalId) return s;
      const data = readData(s.providerData);
      data.pendingRequestId = null;
      data.requestIds.push(requestId);
      data.claimIds.push(externalId);
      data.version = null;
      data.updatedTs = null;
      data.errors = [];
      data.claimCreatedAt = now.toISOString();
      data.acceptRequest = null;
      const history = (Array.isArray(s.history)
        ? s.history
        : []) as unknown as StoredHistoryEntry[];
      history.push({
        at: now.toISOString(),
        status: 'CREATED',
        providerStatus: 'new',
        place: '',
        note: '',
      });
      const updated = await tx.shipment.update({
        where: { id: s.id },
        data: {
          externalId,
          status: 'CREATED',
          providerStatus: 'new',
          providerData: json(data),
          acceptedAt: null,
          courier: Prisma.DbNull,
          history: json(history),
          nextSyncAt: now,
          syncFailures: 0,
        },
        include: { order: { select: { id: true, status: true } } },
      });
      await tx.orderEvent.create({
        data: {
          orderId: s.orderId,
          type: 'DELIVERY_CLAIM_CREATED',
          from: s.status,
          to: 'CREATED',
          actorType: actor.type,
          actorId: actor.id ?? null,
          data: { carrier: 'YANDEX', claimId: externalId, requestId },
        },
      });
      await audit?.(tx);
      return updated;
    });
    return this.summary(saved);
  }

  /**
   * Staff confirms the estimated claim: Yandex starts the courier search (real courier, real
   * charge). Refused in test mode. Three steps so no HTTP call runs inside a lock-holding
   * transaction: (1) under the order → shipment locks record `acceptRequest` (a second click or
   * another staff member within the lease is a no-op), (2) call Yandex, (3) record the outcome.
   * A claim already accepted (here or in the Yandex cabinet) is a no-op.
   */
  async acceptClaim(shipmentId: string, actor: Actor, audit?: TxHook): Promise<ShipmentSummary> {
    const provider = await this.provider();
    if (provider instanceof YandexDeliveryProvider && provider.isTestMode)
      throw new DomainError('DELIVERY_TEST_MODE');
    const claimId = await this.prisma.$transaction(async (tx) => {
      const s = await this.lockBoth(tx, shipmentId);
      if (s.carrier !== 'YANDEX' || !s.externalId || yandexClaimDead(s))
        throw new DomainError('DELIVERY_CLAIM_NOT_READY');
      if (s.acceptedAt || acceptPending(s, new Date())) return null;
      if (!CLAIMABLE.includes(s.order.status))
        throw new DomainError('SHIPMENT_ORDER_NOT_READY', { status: s.order.status });
      const data = readData(s.providerData);
      data.acceptRequest = {
        by: actor.id ?? null,
        at: new Date().toISOString(),
        claimId: s.externalId,
      };
      await tx.shipment.update({ where: { id: s.id }, data: { providerData: json(data) } });
      return s.externalId;
    });
    if (claimId) {
      const failure = await this.dispatch(provider, claimId).then(
        () => null,
        (e: unknown) => toDomainError(e),
      );
      await this.prisma.$transaction(async (tx) => {
        const s = await this.lockBoth(tx, shipmentId);
        const data = readData(s.providerData);
        if (data.acceptRequest?.claimId === claimId) data.acceptRequest = null;
        const accepted = !failure && s.externalId === claimId;
        await tx.shipment.update({
          where: { id: s.id },
          data: {
            providerData: json(data),
            // A sync may have seen the acceptance first; the staff action is still recorded.
            ...(accepted ? { acceptedAt: s.acceptedAt ?? new Date(), nextSyncAt: new Date() } : {}),
          },
        });
        if (accepted)
          await tx.orderEvent.create({
            data: {
              orderId: s.orderId,
              type: 'DELIVERY_ACCEPTED',
              actorType: actor.type,
              actorId: actor.id ?? null,
              data: { carrier: 'YANDEX', claimId },
            },
          });
        if (accepted) await audit?.(tx);
      });
      if (failure) throw failure;
    }
    await this.refresh(shipmentId).catch((e: unknown) =>
      this.logger.warn(`refresh after accept ${shipmentId} failed: ${String(e)}`),
    );
    return this.summary(
      await this.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } }),
    );
  }

  /** claims/accept unless Yandex already shows the claim accepted; resolves only when it is. */
  private async dispatch(provider: DeliveryProvider, claimId: string): Promise<void> {
    const state = await provider.getState(claimId);
    const raw = state.providerStatus ?? null;
    if (raw !== null && !PRE_ACCEPT.includes(raw) && !state.terminal) return;
    if (raw !== null && raw !== 'ready_for_approval')
      throw new DomainError('DELIVERY_CLAIM_NOT_READY', { providerStatus: raw });
    if (!provider.accept) throw new DomainError('DELIVERY_CLAIM_NOT_READY');
    try {
      await provider.accept(claimId, state.version);
    } catch (e) {
      // Unknown outcome (timeout) or a race with the cabinet: Yandex's own state decides.
      const after = await provider.getState(claimId).catch(() => null);
      const st = after?.providerStatus ?? null;
      if (st !== null && !PRE_ACCEPT.includes(st) && !after?.terminal) return;
      if (e instanceof YandexApiError && e.status === 409)
        throw new DomainError('DELIVERY_CLAIM_NOT_READY', { code: e.code });
      throw e;
    }
  }

  /**
   * Cancels the claim (free by default; `allowPaid` after staff saw the fee). Only before the
   * parcel is handed over — afterwards Yandex support must be contacted (docs).
   */
  async cancelClaim(
    shipmentId: string,
    actor: Actor,
    opts: { allowPaid?: boolean } = {},
    audit?: TxHook,
  ): Promise<ShipmentSummary> {
    const provider = await this.provider();
    await this.prisma.$transaction(
      async (tx) => {
        const s = await this.lockBoth(tx, shipmentId);
        if (s.carrier !== 'YANDEX' || !s.externalId || yandexClaimDead(s)) return;
        try {
          await provider.cancel(s.externalId, opts);
        } catch (e) {
          if (e instanceof YandexApiError && e.code === 'cancel_unavailable')
            throw new DomainError('DELIVERY_CANCEL_UNAVAILABLE');
          if (e instanceof YandexApiError && e.code === 'cancel_paid')
            throw new DomainError('DELIVERY_CANCEL_PAID');
          const after = await provider.getState(s.externalId).catch(() => null);
          if (!after?.terminal) throw toDomainError(e);
        }
        await tx.shipment.update({ where: { id: s.id }, data: { nextSyncAt: new Date() } });
        await tx.orderEvent.create({
          data: {
            orderId: s.orderId,
            type: 'DELIVERY_CANCELLED',
            actorType: actor.type,
            actorId: actor.id ?? null,
            data: {
              carrier: 'YANDEX',
              claimId: s.externalId,
              paidAllowed: Boolean(opts.allowPaid),
            },
          },
        });
        await audit?.(tx);
      },
      { timeout: 30_000 },
    );
    await this.refresh(shipmentId).catch((e: unknown) =>
      this.logger.warn(`refresh after cancel ${shipmentId} failed: ${String(e)}`),
    );
    return this.summary(
      await this.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } }),
    );
  }

  /**
   * Reads the claim from Yandex and applies it: status mapping, history, courier, order
   * transitions (OrderLifecycleService), OrderEvents and — after commit — customer SMS.
   * Idempotent: an equal or older claim state (by `updated_ts`) changes nothing.
   */
  async refresh(
    shipmentId: string,
    now = new Date(),
  ): Promise<{ applied: boolean; status: DeliveryStatus }> {
    const current = await this.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    if (current.carrier !== 'YANDEX' || !current.externalId)
      return { applied: false, status: current.status };
    const claimId = current.externalId;
    const provider = await this.provider();
    const storedCourier = current.courier as StoredCourier | null;
    const state = await provider.getState(claimId, { withPhone: !phoneValid(storedCourier, now) });

    const { notices, applied, status } = await this.prisma.$transaction((tx) =>
      this.applyState(tx, shipmentId, claimId, state, now),
    );
    for (const n of notices)
      await this.notifications.orderStatus(current.orderId, n.template, n.vars);
    return { applied, status };
  }

  private async applyState(
    tx: Tx,
    shipmentId: string,
    claimId: string,
    state: ShipmentState,
    now: Date,
  ): Promise<{ notices: Notice[]; applied: boolean; status: DeliveryStatus }> {
    const s = await this.lockBoth(tx, shipmentId);
    // A new claim replaced this one meanwhile, or the answer is older than what we applied.
    if (s.externalId !== claimId) return { notices: [], applied: false, status: s.status };
    const data = readData(s.providerData);
    const incomingTs = state.updatedAt ?? null;
    if (incomingTs && data.updatedTs && incomingTs.getTime() < new Date(data.updatedTs).getTime())
      return { notices: [], applied: false, status: s.status };

    const from = s.status;
    const mapped = state.knownStatus === false ? from : state.status;
    const changes = mapped !== from && canTransitionDelivery(from, mapped);
    if (mapped !== from && !changes)
      this.logger.warn(
        `shipment ${s.id}: ignoring ${from} → ${mapped} (${state.providerStatus ?? '?'})`,
      );
    if (state.knownStatus === false)
      this.logger.warn(`shipment ${s.id}: unknown Yandex status ${state.providerStatus ?? '?'}`);
    const to = changes ? mapped : from;
    const terminal = state.terminal ?? (to === 'DELIVERED' || to === 'RETURNED');

    data.version = state.version ?? data.version;
    data.updatedTs = incomingTs?.toISOString() ?? data.updatedTs;
    if (state.carrierPriceTiyin != null) data.costTiyin = state.carrierPriceTiyin.toString();
    data.errors = state.errors ?? [];

    const courier = mergeCourier(s.courier as StoredCourier | null, state.courier, now);
    const history = (Array.isArray(s.history) ? s.history : []) as unknown as StoredHistoryEntry[];
    if (changes)
      history.push({
        at: (incomingTs ?? now).toISOString(),
        status: to,
        providerStatus: state.providerStatus ?? null,
        place: '',
        note: '',
      });
    const awaitingAccept = !s.acceptedAt && PRE_ACCEPT.includes(state.providerStatus ?? '');
    // Nobody will accept this claim any more: the order is gone, or the estimate is a day old
    // (accept / refresh restart polling).
    const claimCreatedAt = Date.parse(data.claimCreatedAt ?? s.createdAt.toISOString());
    const abandoned =
      awaitingAccept &&
      !acceptPending(s, now) &&
      (s.order.status === 'CANCELLED' ||
        now.getTime() - claimCreatedAt > SYNC_POLICY.stopAwaitingAfterMs);
    await tx.shipment.update({
      where: { id: s.id },
      data: {
        status: to,
        providerStatus: state.providerStatus ?? s.providerStatus,
        providerData: json(data),
        courier: courier ? json(courier) : undefined,
        history: json(history),
        syncedAt: now,
        syncFailures: 0,
        nextSyncAt:
          terminal || abandoned
            ? null
            : new Date(
                now.getTime() +
                  (awaitingAccept && state.providerStatus === 'ready_for_approval'
                    ? SYNC_POLICY.awaitingAcceptMs
                    : SYNC_POLICY.activeMs),
              ),
        // Accepted in the Yandex cabinet: record it, so our accept button becomes a no-op.
        ...(!s.acceptedAt &&
        state.providerStatus &&
        !PRE_ACCEPT.includes(state.providerStatus) &&
        !terminal
          ? { acceptedAt: now }
          : {}),
      },
    });
    if (abandoned) this.logger.log(`shipment ${s.id}: claim never accepted, polling stopped`);

    // Returning / items on hands without `pickuped` seen: the parcel did leave the warehouse.
    const handedOver = to === 'FAILED' && yandexParcelOutFailed(state.providerStatus ?? '');
    let entered: OrderStatus[] = [];
    if (changes) {
      await tx.orderEvent.create({
        data: {
          orderId: s.orderId,
          type: 'DELIVERY_STATUS',
          from,
          to,
          actorType: CARRIER_ACTOR.type,
          actorId: CARRIER_ACTOR.id,
          data: { carrier: 'YANDEX', claimId, providerStatus: state.providerStatus ?? null },
        },
      });
      entered = await this.lifecycle.advanceForDelivery(tx, s.orderId, to, CARRIER_ACTOR, {
        handedOver,
      });
    }
    const orderNow = entered.at(-1) ?? s.order.status;

    const attention: string[] = [];
    if (changes && s.order.status === 'CANCELLED' && (PARCEL_MOVED.includes(to) || handedOver))
      attention.push('cancelled_order_parcel_moved');
    // The claim died with the parcel out (no return reported): staff must find it — markReturned.
    if (
      to === 'FAILED' &&
      terminal &&
      state.providerStatus !== s.providerStatus &&
      orderNow === 'HANDED_TO_COURIER'
    )
      attention.push('failed_after_pickup');
    for (const reason of attention) {
      this.logger.error(
        `shipment ${s.id} (order ${s.orderId}) needs attention: ${reason} (${state.providerStatus ?? '?'})`,
      );
      await tx.orderEvent.create({
        data: {
          orderId: s.orderId,
          type: 'DELIVERY_NEEDS_ATTENTION',
          actorType: CARRIER_ACTOR.type,
          actorId: CARRIER_ACTOR.id,
          data: {
            carrier: 'YANDEX',
            claimId,
            reason,
            providerStatus: state.providerStatus ?? null,
          },
        },
      });
    }
    if (!changes) return { notices: [], applied: true, status: to };

    const notices: Notice[] = [];
    // "On the way" only while it is: never for a jump straight to delivered / failed / returned.
    if (entered.includes('HANDED_TO_COURIER') && ON_THE_WAY.includes(to)) {
      notices.push(
        courier?.etaAt
          ? { template: 'order_courier', vars: { vaqt: formatTashkentHm(new Date(courier.etaAt)) } }
          : { template: 'order_shipped' },
      );
    }
    if (entered.includes('DELIVERED')) notices.push({ template: 'order_delivered' });
    // The parcel was with the courier and is coming back (or stuck): tell the customer once.
    if (
      to === 'FAILED' &&
      orderNow === 'HANDED_TO_COURIER' &&
      !(await this.lifecycle.deliveryNoticeSent(tx, s.orderId, s.id, 'order_delivery_failed'))
    )
      notices.push({ template: 'order_delivery_failed' });
    for (const n of notices)
      await this.lifecycle.recordDeliveryNotice(tx, s.orderId, s.id, n.template, to);
    return { notices, applied: true, status: to };
  }

  /**
   * Staff found the parcel of a failed claim back in the warehouse (e.g. the claim died after
   * pickup — `DELIVERY_NEEDS_ATTENTION`): shipment and order → RETURNED, stock hold released.
   */
  async markReturned(
    shipmentId: string,
    actor: Actor,
    now = new Date(),
    audit?: TxHook,
  ): Promise<ShipmentSummary> {
    const saved = await this.prisma.$transaction(async (tx) => {
      const s = await this.lockBoth(tx, shipmentId);
      if (s.carrier !== 'YANDEX' || s.status !== 'FAILED' || s.order.status !== 'HANDED_TO_COURIER')
        throw new DomainError('DELIVERY_INVALID_TRANSITION', { from: s.status, to: 'RETURNED' });
      const history = (Array.isArray(s.history)
        ? s.history
        : []) as unknown as StoredHistoryEntry[];
      history.push({
        at: now.toISOString(),
        status: 'RETURNED',
        providerStatus: null,
        place: '',
        note: '',
      });
      const updated = await tx.shipment.update({
        where: { id: s.id },
        data: { status: 'RETURNED', history: json(history), nextSyncAt: null },
      });
      await tx.orderEvent.create({
        data: {
          orderId: s.orderId,
          type: 'DELIVERY_STATUS',
          from: s.status,
          to: 'RETURNED',
          actorType: actor.type,
          actorId: actor.id ?? null,
          data: { carrier: 'YANDEX', claimId: s.externalId, manual: true },
        },
      });
      await this.lifecycle.advanceForDelivery(tx, s.orderId, 'RETURNED', actor);
      await audit?.(tx);
      return updated;
    });
    return this.summary(saved);
  }

  /**
   * Polling job: active claims whose `nextSyncAt` is due. Each shipment is leased with a
   * conditional update first, so a second (overlapping) run skips it; errors back off per shipment.
   */
  async syncDue(now = new Date()): Promise<number> {
    const due = await this.prisma.shipment.findMany({
      where: {
        carrier: 'YANDEX',
        externalId: { not: null },
        nextSyncAt: { lte: now },
      },
      orderBy: { nextSyncAt: 'asc' },
      select: { id: true, nextSyncAt: true },
      take: SYNC_POLICY.batch,
    });
    let n = 0;
    for (const { id, nextSyncAt } of due) {
      const lease = await this.prisma.shipment.updateMany({
        where: { id, nextSyncAt },
        data: { nextSyncAt: new Date(now.getTime() + SYNC_POLICY.leaseMs) },
      });
      if (lease.count !== 1) continue;
      try {
        await this.refresh(id, now);
        n++;
      } catch (e) {
        const s = await this.prisma.shipment.update({
          where: { id },
          data: { syncFailures: { increment: 1 } },
          select: { syncFailures: true },
        });
        await this.prisma.shipment.update({
          where: { id },
          data: { nextSyncAt: new Date(now.getTime() + syncBackoffMs(s.syncFailures)) },
        });
        this.logger.warn(`sync ${id} failed (${s.syncFailures}x): ${String(e).slice(0, 200)}`);
        await this.integrations
          .log('yandex_delivery', {
            direction: 'OUT',
            kind: 'claims.info',
            ok: false,
            message: String(e),
            payload: { shipmentId: id, failures: s.syncFailures },
          })
          .catch(() => undefined);
      }
    }
    return n;
  }

  /** Callback → shipment id (unknown claims are ignored). */
  async shipmentIdForClaim(claimId: string): Promise<string | null> {
    const s = await this.prisma.shipment.findFirst({
      where: { carrier: 'YANDEX', externalId: claimId },
      select: { id: true },
    });
    return s?.id ?? null;
  }
}
