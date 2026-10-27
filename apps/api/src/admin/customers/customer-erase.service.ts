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
import { PrismaService } from '../../prisma/prisma.service';
import { type AuditActor, AuditService } from '../audit/audit.service';

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
  ) {}

  async erase(actor: AuditActor, id: string, confirm: string): Promise<CustomerEraseResultDto> {
    const result = await this.prisma.$transaction(async (tx) => {
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
      await tx.visitor.updateMany({ where: { customerId: id }, data: { customerId: null } });
      await tx.session.updateMany({ where: { customerId: id }, data: { customerId: null } });
      await tx.message.updateMany({ where: { customerId: id }, data: { body: '' } });
      await tx.conversationMessage.updateMany({
        where: { conversation: { customerId: id } },
        data: { text: null, fileIds: [] },
      });
      await tx.segmentMember.deleteMany({ where: { customerId: id } });

      // Orders stay (tax/fiscal retention) without contact details; the region remains for stats.
      const orders = await tx.order.findMany({
        where: { customerId: id },
        select: { id: true, address: true },
      });
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
          },
        },
        tx,
      );
      return { erasedAt: now.toISOString(), ordersKept: orders.length };
    });
    // After commit: any live storefront session of this customer ends.
    await this.sessions.revokeCustomer(id).catch((e: unknown) => {
      this.logger.error(`session revoke failed after erasure: ${String(e)}`);
    });
    return result;
  }
}
