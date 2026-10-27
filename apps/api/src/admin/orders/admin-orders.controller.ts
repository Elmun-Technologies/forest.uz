import {
  Body,
  Get,
  Header,
  HttpCode,
  Param,
  type PipeTransform,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type AdminBtsUpdateInput,
  adminBtsUpdateSchema,
  type AdminClaimCancelInput,
  adminClaimCancelSchema,
  type AdminManualOrderInput,
  type AdminManualOrderResultDto,
  adminManualOrderSchema,
  type AdminOrderActionResultDto,
  type AdminOrderBadgeDto,
  type AdminOrderCancelInput,
  adminOrderCancelSchema,
  type AdminOrderDetailDto,
  type AdminOrderFilter,
  adminOrderFilterSchema,
  type AdminOrderNoteInput,
  adminOrderNoteSchema,
  type AdminOrderPageDto,
  type AdminOrderPiiDto,
  type AdminOrderQuery,
  adminOrderQuerySchema,
  type AdminOrderReceiptInput,
  adminOrderReceiptSchema,
  type AdminOrderRefundInput,
  adminOrderRefundSchema,
  type AdminRefundResultDto,
  type AdminVariantOptionDto,
  adminVariantSearchSchema,
  DomainError,
  isOrderNumber,
} from '@forest/contracts';
import type { Request, Response } from 'express';
import { ZodPipe } from '../../common/http';
import type { AdminContext } from '../admin-access';
import { Actor, Admin, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import { AdminOrderActionsService } from './admin-order-actions.service';
import { AdminOrdersService } from './admin-orders.service';

/** `:number` must look like an order number (`F-10482`); anything else is simply not found. */
class OrderNumberPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isOrderNumber(value)) throw new DomainError('ORDER_NOT_FOUND');
    return value;
  }
}

const IDEMPOTENCY_KEY = /^[\w-]{16,80}$/;

function idempotencyKey(req: Request): string {
  const key = req.header('idempotency-key');
  if (!key || !IDEMPOTENCY_KEY.test(key)) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED');
  return key;
}

/**
 * A6/A7 orders (docs/08). Permissions per route below and in CLAUDE.md §6; every mutation writes
 * its audit row in the change's transaction (AdminOrderActionsService).
 */
@AdminController('orders')
export class AdminOrdersController {
  constructor(
    private readonly orders: AdminOrdersService,
    private readonly actions: AdminOrderActionsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('orders.view')
  list(@Query(new ZodPipe(adminOrderQuerySchema)) q: AdminOrderQuery): Promise<AdminOrderPageDto> {
    return this.orders.list(q);
  }

  @Get('badge')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('orders.view')
  badge(): Promise<AdminOrderBadgeDto> {
    return this.orders.badge();
  }

  @Get('variants')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('orders.edit')
  variants(
    @Query(new ZodPipe(adminVariantSearchSchema)) q: { q: string },
  ): Promise<AdminVariantOptionDto[]> {
    return this.orders.variants(q.q);
  }

  /** CSV of the current filter; full phones only with `customers.export` (CLAUDE.md §6). */
  @Post('export')
  @HttpCode(200)
  @RequirePermissions('orders.view')
  async export(
    @Body(new ZodPipe(adminOrderFilterSchema)) f: AdminOrderFilter,
    @Admin() admin: AdminContext,
    @Actor() actor: AuditActor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { csv } = await this.orders.exportCsv(actor, f, admin.permissions);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="buyurtmalar.csv"');
    res.setHeader('Cache-Control', 'no-store');
    return csv;
  }

  @Post()
  @RequirePermissions('orders.edit')
  manual(
    @Req() req: Request,
    @Body(new ZodPipe(adminManualOrderSchema)) body: AdminManualOrderInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminManualOrderResultDto> {
    return this.actions.manualOrder(actor, idempotencyKey(req), body);
  }

  @Get(':number')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('orders.view')
  detail(
    @Param('number', OrderNumberPipe) number: string,
    @Admin() admin: AdminContext,
  ): Promise<AdminOrderDetailDto> {
    return this.orders.detail(number, admin.permissions);
  }

  /** Full receiver data; audited `order.view_pii` (customers.pii / customers.pii_partial). */
  @Post(':number/pii')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('orders.view')
  pii(
    @Param('number', OrderNumberPipe) number: string,
    @Admin() admin: AdminContext,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderPiiDto> {
    return this.orders.pii(actor, number, admin.permissions);
  }

  @Post(':number/confirm')
  @HttpCode(200)
  @RequirePermissions('orders.edit')
  confirm(
    @Param('number', OrderNumberPipe) number: string,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.confirmCod(actor, number);
  }

  /** COD cash received from the courier (after hand-over). */
  @Post(':number/cod-paid')
  @HttpCode(200)
  @RequirePermissions('orders.edit')
  codPaid(
    @Param('number', OrderNumberPipe) number: string,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.codSettled(actor, number);
  }

  @Post(':number/packing')
  @HttpCode(200)
  @RequirePermissions('orders.edit')
  packing(
    @Param('number', OrderNumberPipe) number: string,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.advance(actor, number, 'PACKING');
  }

  @Post(':number/ready')
  @HttpCode(200)
  @RequirePermissions('orders.edit')
  ready(
    @Param('number', OrderNumberPipe) number: string,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.advance(actor, number, 'READY');
  }

  /** PICKUP orders only; carriers report delivery themselves (BTS: the `bts` route). */
  @Post(':number/delivered')
  @HttpCode(200)
  @RequirePermissions('orders.edit')
  delivered(
    @Param('number', OrderNumberPipe) number: string,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.markDelivered(actor, number);
  }

  @Post(':number/complete')
  @HttpCode(200)
  @RequirePermissions('orders.edit')
  complete(
    @Param('number', OrderNumberPipe) number: string,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.complete(actor, number);
  }

  @Post(':number/receipt')
  @HttpCode(200)
  @RequirePermissions('orders.edit')
  receipt(
    @Param('number', OrderNumberPipe) number: string,
    @Body(new ZodPipe(adminOrderReceiptSchema)) body: AdminOrderReceiptInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.recordReceipt(actor, number, body);
  }

  @Post(':number/cancel')
  @HttpCode(200)
  @RequirePermissions('orders.cancel_refund')
  cancel(
    @Param('number', OrderNumberPipe) number: string,
    @Body(new ZodPipe(adminOrderCancelSchema)) body: AdminOrderCancelInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.cancel(actor, number, body.reason);
  }

  @Post(':number/refunds')
  @HttpCode(200)
  @RequirePermissions('orders.cancel_refund')
  refund(
    @Req() req: Request,
    @Param('number', OrderNumberPipe) number: string,
    @Body(new ZodPipe(adminOrderRefundSchema)) body: AdminOrderRefundInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminRefundResultDto> {
    return this.actions.refund(actor, number, idempotencyKey(req), body);
  }

  @Post(':number/notes')
  @HttpCode(200)
  @RequirePermissions('orders.edit')
  note(
    @Param('number', OrderNumberPipe) number: string,
    @Body(new ZodPipe(adminOrderNoteSchema)) body: AdminOrderNoteInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.note(actor, number, body.text);
  }

  @Post(':number/bts')
  @HttpCode(200)
  @RequirePermissions('orders.edit')
  bts(
    @Param('number', OrderNumberPipe) number: string,
    @Body(new ZodPipe(adminBtsUpdateSchema)) body: AdminBtsUpdateInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.bts(actor, number, body);
  }

  @Post(':number/yandex/claim')
  @HttpCode(200)
  @RequirePermissions('orders.edit')
  yandexClaim(
    @Param('number', OrderNumberPipe) number: string,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.yandexCreate(actor, number);
  }

  @Post(':number/yandex/accept')
  @HttpCode(200)
  @RequirePermissions('orders.edit')
  yandexAccept(
    @Param('number', OrderNumberPipe) number: string,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.yandexAccept(actor, number);
  }

  @Post(':number/yandex/cancel')
  @HttpCode(200)
  @RequirePermissions('orders.edit')
  yandexCancel(
    @Param('number', OrderNumberPipe) number: string,
    @Body(new ZodPipe(adminClaimCancelSchema)) body: AdminClaimCancelInput,
    @Admin() admin: AdminContext,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.yandexCancel(actor, number, body.allowPaid, admin.permissions);
  }

  @Post(':number/yandex/refresh')
  @HttpCode(200)
  @RequirePermissions('orders.edit')
  yandexRefresh(
    @Param('number', OrderNumberPipe) number: string,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.yandexRefresh(actor, number);
  }

  @Post(':number/yandex/returned')
  @HttpCode(200)
  @RequirePermissions('orders.edit')
  yandexReturned(
    @Param('number', OrderNumberPipe) number: string,
    @Actor() actor: AuditActor,
  ): Promise<AdminOrderActionResultDto> {
    return this.actions.yandexReturned(actor, number);
  }
}
