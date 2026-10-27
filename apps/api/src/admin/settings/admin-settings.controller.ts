import { Body, Get, Put, Query, Res } from '@nestjs/common';
import {
  type DeliveryPreviewDto,
  deliveryPreviewQuerySchema,
  type DeliverySettingsDto,
  type DeliverySettingsInput,
  deliverySettingsInputSchema,
  type StoreSettingsDto,
  type StoreSettingsInput,
  storeSettingsInputSchema,
} from '@forest/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { ZodPipe } from '../../common/http';
import { Actor, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import { AdminSettingsService } from './admin-settings.service';

/** A16 "Do'kon" (`settings.store`, Owner) and "Yetkazish" (`settings.delivery`, O/M). */
@AdminController('settings')
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get('store')
  @RequirePermissions('settings.store')
  store(@Res({ passthrough: true }) res: Response): Promise<StoreSettingsDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.settings.store();
  }

  @Put('store')
  @RequirePermissions('settings.store')
  saveStore(
    @Body(new ZodPipe(storeSettingsInputSchema)) body: StoreSettingsInput,
    @Actor() actor: AuditActor,
  ): Promise<StoreSettingsDto> {
    return this.settings.saveStore(actor, body);
  }

  @Get('delivery')
  @RequirePermissions('settings.delivery')
  delivery(@Res({ passthrough: true }) res: Response): Promise<DeliverySettingsDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.settings.delivery();
  }

  @Put('delivery')
  @RequirePermissions('settings.delivery')
  saveDelivery(
    @Body(new ZodPipe(deliverySettingsInputSchema)) body: DeliverySettingsInput,
    @Actor() actor: AuditActor,
  ): Promise<DeliverySettingsDto> {
    return this.settings.saveDelivery(actor, body);
  }

  /** Storefront promise texts for the saved zones at `at` (default now). */
  @Get('delivery/preview')
  @RequirePermissions('settings.delivery')
  preview(
    @Query(new ZodPipe(deliveryPreviewQuerySchema)) q: z.infer<typeof deliveryPreviewQuerySchema>,
  ): Promise<DeliveryPreviewDto> {
    return this.settings.preview(q.at ? new Date(q.at) : new Date());
  }
}
