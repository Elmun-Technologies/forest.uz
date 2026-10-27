import { Body, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type AdminPromoDto,
  type AdminPromoListQuery,
  adminPromoListQuerySchema,
  type AdminPromoPageDto,
  type AdminPromoSummaryDto,
  type PromoCreateInput,
  promoCreateSchema,
  type PromoUpdateInput,
  promoUpdateSchema,
} from '@forest/contracts';
import { ZodPipe } from '../../common/http';
import { Actor, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import { AdminPromoService } from './promo.service';

/** A14 Promo-kodlar: O/M/Mk (`promo.edit`, docs/02 "Promo codes"). No delete — deactivate. */
@AdminController('promo')
export class AdminPromoController {
  constructor(private readonly promo: AdminPromoService) {}

  @Get('summary')
  @RequirePermissions('promo.edit')
  summary(): Promise<AdminPromoSummaryDto> {
    return this.promo.summary();
  }

  @Get()
  @RequirePermissions('promo.edit')
  list(
    @Query(new ZodPipe(adminPromoListQuerySchema)) q: AdminPromoListQuery,
  ): Promise<AdminPromoPageDto> {
    return this.promo.list(q);
  }

  @Get(':id')
  @RequirePermissions('promo.edit')
  get(@Param('id') id: string): Promise<AdminPromoDto> {
    return this.promo.get(id);
  }

  @Post()
  @RequirePermissions('promo.edit')
  create(
    @Body(new ZodPipe(promoCreateSchema)) body: PromoCreateInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminPromoDto> {
    return this.promo.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('promo.edit')
  update(
    @Param('id') id: string,
    @Body(new ZodPipe(promoUpdateSchema)) body: PromoUpdateInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminPromoDto> {
    return this.promo.update(actor, id, body);
  }
}

@Module({ controllers: [AdminPromoController], providers: [AdminPromoService] })
export class AdminPromoModule {}
