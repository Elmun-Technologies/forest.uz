import { botChatRedisKeys } from '../../bot/bot-session';
import { RedisService } from '../../redis/redis.module';
import { Injectable, Logger } from '@nestjs/common';
import {
  type CustomerEraseResultDto,
  DomainError,
  OPEN_ORDER_STATUSES,
  type OrderStatus,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { SessionService } from '../../common/session';
import { ConsentsService } from '../../customer/common/consents';
import { ReplayRetentionService } from '../../heatmaps/replay-retention.service';
import { PrismaService } from '../../prisma/prisma.service';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AdminUploadService } from '../files/upload.service';

const ERASED_NAME = '—';

/**
 * Data subject erasure (docs/02, docs/14; CLAUDE.md §6 "Customer erase"). Personal data is
 * removed or blanked; orders, payments, refunds and fiscal receipts stay for tax/legal retention,
 * reduced to non-identifying fields. One transaction under the customer row lock.
 */
@Injectable()
export class CustomerEraseService {
  private readonly logger = new Logger('CustomerErase');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly consents: ConsentsService,
    private readonly sessions: SessionService,
    private readonly uploads: AdminUploadService,
    private readonly replays: ReplayRetentionService,
    private readonly redis: RedisService,
  ) {}

  async erase(actor: AuditActor, id: string, confirm: string): Promise<CustomerEraseResultDto> {
    const { result, photoIds, replayKeys, chat } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${id} FOR UPDATE`;
      const c = await tx.customer.findUnique({ where: { id } });
      if (!c) throw new DomainError('NOT_FOUND');
      if (c.deletedAt) throw new DomainError('CUSTOMER_ERASED');
      if (confirm.toUpperCase() !== c.publicId.toUpperCase())
        throw new DomainError('ADMIN_CONFIRM_MISMATCH', { expected: c.publicId }, 'confirm');
      const open = await tx.order.count({
        where: { customerId: id, status: { in: [...OPEN_ORDER_STATUSES] as OrderStatus[] } },
      });
      if (open > 0) throw new DomainError('CUSTOMER_HAS_OPEN_ORDERS', { open });

      const now = new Date();
      // Marketing stops for good: revoke whatever is granted (history rows stay as evidence).
      await this.consents.record(
        tx,
        id,
        { smsMarketing: false, telegram: false, adsMatching: false },
        'erasure',
      );
      const addresses = await tx.address.deleteMany({ where: { customerId: id } });
      await tx.favorite.deleteMany({ where: { customerId: id } });
      const notes = await tx.customerNote.deleteMany({ where: { customerId: id } });
      const carts = await tx.cart.deleteMany({ where: { customerId: id } });
      if (c.phone) await tx.otpCode.deleteMany({ where: { phone: c.phone } });
      // Session recordings of this person (their sessions and their visitors' ones) go too.
      const visitorIds = (
        await tx.visitor.findMany({ where: { customerId: id }, select: { anonymousId: true } })
      ).map((v) => v.anonymousId);
      const replayWhere = {
        hasReplay: true,
        OR: [{ customerId: id }, { anonymousId: { in: visitorIds } }],
      };
      const replayKeys = (
        await tx.session.findMany({ where: replayWhere, select: { replayKey: true } })
      ).flatMap((r) => (r.replayKey ? [r.replayKey] : []));
      await tx.session.updateMany({
        where: replayWhere,
        data: { hasReplay: false, replayKey: null },
      });
      await tx.visitor.updateMany({ where: { customerId: id }, data: { customerId: null } });
      await tx.session.updateMany({ where: { customerId: id }, data: { customerId: null } });
      // Analytics events stamped by identity stitching / server events (no index on customerId:
      // erase is a rare Owner action, the scan is acceptable).
      await tx.$executeRaw`UPDATE "Event" SET "customerId" = NULL WHERE "customerId" = ${id}`;
      await tx.message.updateMany({ where: { customerId: id }, data: { body: '' } });
      // Bot chat (5A): the customer's conversations and also anything of their Telegram chat
      // from before the phone was linked; photos (private bucket) go with the texts.
      const chat = c.telegramId;
      const chatConvs = {
        OR: [{ customerId: id }, ...(chat ? [{ telegramChatId: chat }] : [])],
      };
      const chatFileIds = (
        await tx.conversationMessage.findMany({
          where: { conversation: chatConvs, NOT: { fileIds: { isEmpty: true } } },
          select: { fileIds: true },
        })
      ).flatMap((m) => m.fileIds);
      await tx.conversationMessage.updateMany({
        where: { conversation: chatConvs },
        data: { text: null, fileIds: [] },
      });
      if (chat)
        await tx.message.updateMany({
          where: { customerId: null, payload: { path: ['chatId'], equals: String(chat) } },
          data: { body: '' },
        });
      // Bot subscriber rows hold the Telegram name/username.
      await tx.botSubscriber.deleteMany({
        where: { OR: [{ customerId: id }, ...(chat ? [{ telegramId: chat }] : [])] },
      });
      await tx.segmentMember.deleteMany({ where: { customerId: id } });
      // Telegram chat id identifies the person; the column is NOT NULL, 0 = erased (no real chat).
      await tx.conversation.updateMany({ where: chatConvs, data: { telegramChatId: 0n } });

      // Review photos may show the person or their home: detach them (text/rating stay, now
      // anonymous). A staff-uploaded "before" image is not the customer's and stays.
      const reviews = await tx.review.findMany({
        where: { customerId: id },
        select: { id: true, photoFileIds: true, beforeFileId: true },
      });
      const photoIds: string[] = [...chatFileIds];
      for (const r of reviews) {
        const own = r.beforeFileId !== null && r.photoFileIds.includes(r.beforeFileId);
        if (r.photoFileIds.length === 0) continue;
        photoIds.push(...r.photoFileIds);
        await tx.review.update({
          where: { id: r.id },
          data: {
            photoFileIds: [],
            photoConsent: false,
            inGallery: false,
            gallerySort: null,
            ...(own ? { beforeFileId: null } : {}),
          },
        });
      }

      // External copies are not erased automatically: listed in the result and the audit row.
      const links = await tx.moyskladOrderLink.findMany({
        where: { order: { customerId: id }, counterpartyId: { not: null } },
        select: { counterpartyId: true },
      });
      const external = [...new Set(links.map((l) => l.counterpartyId!))].map((counterpartyId) => ({
        system: 'moysklad' as const,
        counterpartyId,
      }));

      // Orders stay (tax/fiscal retention) without contact details; the region remains for stats.
      const orders = await tx.order.findMany({
        where: { customerId: id },
        select: { id: true, address: true },
      });
      // Staff notes on the orders may quote the customer: keep the rows, drop the text.
      if (orders.length)
        await tx.$executeRaw`
          UPDATE "OrderEvent" SET "data" = jsonb_set("data", '{text}', '"—"'::jsonb)
          WHERE "type" = 'NOTE' AND "data" ? 'text'
            AND "orderId" IN (${Prisma.join(orders.map((o) => o.id))})`;
      for (const o of orders) {
        const a = (o.address ?? {}) as { region?: unknown; district?: unknown };
        await tx.order.update({
          where: { id: o.id },
          data: {
            contactName: ERASED_NAME,
            contactPhone: '',
            address: {
              region: typeof a.region === 'string' ? a.region : null,
              district: typeof a.district === 'string' ? a.district : null,
              erased: true,
            },
            comment: null,
            attribution: Prisma.DbNull,
            anonymousId: null,
            sessionId: null,
          },
        });
      }

      await tx.customer.update({
        where: { id },
        data: {
          phone: null,
          name: null,
          telegramId: null,
          telegramUsername: null,
          tags: [],
          firstTouch: Prisma.DbNull,
          lastTouch: Prisma.DbNull,
          deletedAt: now,
        },
      });
      await this.audit.record(
        actor,
        {
          action: 'customer.erase',
          entity: 'Customer',
          entityId: id,
          after: {
            ordersKept: orders.length,
            addressesDeleted: addresses.count,
            notesDeleted: notes.count,
            cartsDeleted: carts.count,
            photosRemoved: photoIds.length,
            external,
          },
        },
        tx,
      );
      const done: CustomerEraseResultDto = {
        erasedAt: now.toISOString(),
        ordersKept: orders.length,
        photosRemoved: photoIds.length,
        external,
      };
      return { result: done, photoIds, replayKeys, chat };
    });
    // After commit: photo files nothing else references go (rows + objects; best effort).
    await this.uploads.discardUnreferenced([...new Set(photoIds)]).catch((e: unknown) => {
      this.logger.error(`photo cleanup failed after erasure: ${String(e)}`);
    });
    // After commit: their replay objects (flags already cleared; retention would catch leftovers).
    await this.replays.removePrefixes(replayKeys).catch((e: unknown) => {
      this.logger.error(`replay cleanup failed after erasure: ${String(e)}`);
    });
    // After commit: the bot's per-chat state (flow, pending visitor, auto-reply throttle).
    if (chat)
      await this.redis.del(...botChatRedisKeys(chat)).catch((e: unknown) => {
        this.logger.error(`bot state cleanup failed after erasure: ${String(e)}`);
      });
    // After commit: any live storefront session of this customer ends.
    await this.sessions.revokeCustomer(id).catch((e: unknown) => {
      this.logger.error(`session revoke failed after erasure: ${String(e)}`);
    });
    return result;
  }
}
