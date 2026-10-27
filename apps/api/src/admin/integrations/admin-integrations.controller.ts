import { Body, Get, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import {
  type IntegrationCredentialsInput,
  integrationCredentialsSchema,
  type IntegrationDetailDto,
  type IntegrationDisconnectInput,
  integrationDisconnectSchema,
  type IntegrationsHubDto,
  type IntegrationTestResultDto,
} from '@forest/contracts';
import type { Response } from 'express';
import { ZodPipe } from '../../common/http';
import { Actor, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import { AdminIntegrationsService } from './admin-integrations.service';

/**
 * A10 Integrations hub. Viewing and health checks: `integrations.view` (O/M); credentials,
 * disconnect and secret callback URLs: `integrations.keys` (Owner, docs/02).
 */
@AdminController('integrations')
export class AdminIntegrationsController {
  constructor(private readonly hub: AdminIntegrationsService) {}

  @Get()
  @RequirePermissions('integrations.view')
  list(@Res({ passthrough: true }) res: Response): Promise<IntegrationsHubDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.hub.hub();
  }

  @Get(':key')
  @RequirePermissions('integrations.view')
  detail(
    @Param('key') key: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IntegrationDetailDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.hub.detail(key);
  }

  @Put(':key')
  @RequirePermissions('integrations.view', 'integrations.keys')
  connect(
    @Param('key') key: string,
    @Body(new ZodPipe(integrationCredentialsSchema)) body: IntegrationCredentialsInput,
    @Actor() actor: AuditActor,
  ): Promise<IntegrationTestResultDto> {
    return this.hub.connect(actor, key, body.fields);
  }

  @Post(':key/test')
  @HttpCode(200)
  @RequirePermissions('integrations.view')
  test(@Param('key') key: string, @Actor() actor: AuditActor): Promise<IntegrationTestResultDto> {
    return this.hub.test(actor, key);
  }

  @Post(':key/disconnect')
  @HttpCode(200)
  @RequirePermissions('integrations.view', 'integrations.keys')
  async disconnect(
    @Param('key') key: string,
    @Body(new ZodPipe(integrationDisconnectSchema)) body: IntegrationDisconnectInput,
    @Actor() actor: AuditActor,
  ): Promise<{ ok: true }> {
    await this.hub.disconnect(actor, key, body.confirm);
    return { ok: true };
  }

  @Post(':key/webhook-url')
  @HttpCode(200)
  @RequirePermissions('integrations.view', 'integrations.keys')
  webhookUrl(
    @Param('key') key: string,
    @Actor() actor: AuditActor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ url: string }> {
    res.setHeader('Cache-Control', 'no-store');
    return this.hub.revealWebhookUrl(actor, key);
  }
}
