import { Body, Get, HttpCode, Patch, Post, Query, Res } from '@nestjs/common';
import {
  type MoyskladLogPageDto,
  type MoyskladLogQuery,
  moyskladLogQuerySchema,
  type MoyskladSettingsPatch,
  moyskladSettingsPatchSchema,
  type MoyskladStatusDto,
  type MoyskladSyncInput,
  type MoyskladSyncResultDto,
  moyskladSyncSchema,
  type MoyskladWebhookRevealDto,
  type MoyskladWebhooksResultDto,
} from '@forest/contracts';
import type { Response } from 'express';
import { ZodPipe } from '../../common/http';
import { Actor, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import { AdminMoyskladService } from './admin-moysklad.service';

/**
 * A13 MoySklad. `moysklad.sync` (O/M/W): status, log, sync now. `moysklad.edit` (O/M): settings,
 * webhook registration. The secret webhook URL also needs `integrations.keys` (Owner).
 */
@AdminController('moysklad')
export class AdminMoyskladController {
  constructor(private readonly svc: AdminMoyskladService) {}

  @Get('status')
  @RequirePermissions('moysklad.sync')
  status(@Res({ passthrough: true }) res: Response): Promise<MoyskladStatusDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.svc.status();
  }

  @Get('log')
  @RequirePermissions('moysklad.sync')
  log(
    @Query(new ZodPipe(moyskladLogQuerySchema)) q: MoyskladLogQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MoyskladLogPageDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.svc.logPage(q);
  }

  @Post('sync')
  @HttpCode(202)
  @RequirePermissions('moysklad.sync')
  async sync(
    @Body(new ZodPipe(moyskladSyncSchema)) body: MoyskladSyncInput,
    @Actor() actor: AuditActor,
  ): Promise<MoyskladSyncResultDto> {
    await this.svc.syncNow(actor, body.scope);
    return { queued: true, scope: body.scope };
  }

  @Patch('settings')
  @RequirePermissions('moysklad.edit')
  settings(
    @Body(new ZodPipe(moyskladSettingsPatchSchema)) body: MoyskladSettingsPatch,
    @Actor() actor: AuditActor,
  ): Promise<MoyskladStatusDto> {
    return this.svc.updateSettings(actor, body);
  }

  @Post('webhooks/register')
  @HttpCode(200)
  @RequirePermissions('moysklad.edit')
  registerWebhooks(@Actor() actor: AuditActor): Promise<MoyskladWebhooksResultDto> {
    return this.svc.registerWebhooks(actor);
  }

  @Post('webhook-url')
  @HttpCode(200)
  @RequirePermissions('moysklad.edit', 'integrations.keys')
  async webhookUrl(@Actor() actor: AuditActor): Promise<MoyskladWebhookRevealDto> {
    return { webhookUrl: await this.svc.revealWebhookUrl(actor) };
  }
}
