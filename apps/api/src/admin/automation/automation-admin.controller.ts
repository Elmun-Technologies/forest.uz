import { Body, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import {
  type ApiKeyCreateInput,
  apiKeyCreateSchema,
  type ApiKeyCreatedDto,
  type ApiKeyDto,
  type WebhookCreateInput,
  webhookCreateSchema,
  type WebhookDeliveriesQuery,
  webhookDeliveriesQuerySchema,
  type WebhookDeliveryDto,
  type WebhookDeliveryPageDto,
  type WebhookEndpointDto,
  type WebhookListDto,
  type WebhookSecretDto,
  type WebhookTestResultDto,
  type WebhookUpdateInput,
  webhookUpdateSchema,
} from '@forest/contracts';
import type { Response } from 'express';
import { ZodPipe } from '../../common/http';
import { Actor, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import { ApiKeysAdminService } from './api-keys-admin.service';
import { WebhooksAdminService } from './webhooks-admin.service';

/**
 * Outbound webhooks (A10): viewing `integrations.view` (O/M); creating, editing, secrets, test and
 * redelivery `integrations.keys` (Owner, docs/02 "Integration keys").
 */
@AdminController('webhooks')
export class AdminWebhooksController {
  constructor(private readonly hooks: WebhooksAdminService) {}

  @Get()
  @RequirePermissions('integrations.view')
  list(@Res({ passthrough: true }) res: Response): Promise<WebhookListDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.hooks.list();
  }

  @Post()
  @RequirePermissions('integrations.view', 'integrations.keys')
  create(
    @Body(new ZodPipe(webhookCreateSchema)) body: WebhookCreateInput,
    @Actor() actor: AuditActor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WebhookSecretDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.hooks.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('integrations.view', 'integrations.keys')
  update(
    @Param('id') id: string,
    @Body(new ZodPipe(webhookUpdateSchema)) body: WebhookUpdateInput,
    @Actor() actor: AuditActor,
  ): Promise<WebhookEndpointDto> {
    return this.hooks.update(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions('integrations.view', 'integrations.keys')
  async remove(@Param('id') id: string, @Actor() actor: AuditActor): Promise<{ ok: true }> {
    await this.hooks.remove(actor, id);
    return { ok: true };
  }

  @Post(':id/rotate-secret')
  @HttpCode(200)
  @RequirePermissions('integrations.view', 'integrations.keys')
  rotate(
    @Param('id') id: string,
    @Actor() actor: AuditActor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WebhookSecretDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.hooks.rotateSecret(actor, id);
  }

  @Get(':id/deliveries')
  @RequirePermissions('integrations.view')
  deliveries(
    @Param('id') id: string,
    @Query(new ZodPipe(webhookDeliveriesQuerySchema)) q: WebhookDeliveriesQuery,
  ): Promise<WebhookDeliveryPageDto> {
    return this.hooks.deliveries(id, q);
  }

  @Post(':id/test')
  @HttpCode(200)
  @RequirePermissions('integrations.view', 'integrations.keys')
  test(@Param('id') id: string, @Actor() actor: AuditActor): Promise<WebhookTestResultDto> {
    return this.hooks.test(actor, id);
  }

  @Post(':id/deliveries/:deliveryId/redeliver')
  @HttpCode(200)
  @RequirePermissions('integrations.view', 'integrations.keys')
  redeliver(
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
    @Actor() actor: AuditActor,
  ): Promise<WebhookDeliveryDto> {
    return this.hooks.redeliver(actor, id, deliveryId);
  }
}

/** Partner API keys: list `integrations.view`; create/revoke `integrations.keys` (Owner). */
@AdminController('api-keys')
export class AdminApiKeysController {
  constructor(private readonly keys: ApiKeysAdminService) {}

  @Get()
  @RequirePermissions('integrations.view')
  list(): Promise<ApiKeyDto[]> {
    return this.keys.list();
  }

  @Post()
  @RequirePermissions('integrations.view', 'integrations.keys')
  create(
    @Body(new ZodPipe(apiKeyCreateSchema)) body: ApiKeyCreateInput,
    @Actor() actor: AuditActor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiKeyCreatedDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.keys.create(actor, body);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermissions('integrations.view', 'integrations.keys')
  revoke(@Param('id') id: string, @Actor() actor: AuditActor): Promise<ApiKeyDto> {
    return this.keys.revoke(actor, id);
  }
}
