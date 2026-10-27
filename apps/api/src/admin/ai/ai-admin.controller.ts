import { Body, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  type AiDraftStatusDto,
  type AiProductDescriptionDraftDto,
  type AiSettingsInput,
  aiSettingsSchema,
  type AiProductDraftInput,
  aiProductDraftSchema,
  type AiReplyDraftDto,
  type AiReplyDraftInput,
  aiReplyDraftSchema,
  type AiSeoDraftDto,
  type AiSeoDraftInput,
  aiSeoDraftSchema,
} from '@forest/contracts';
import { AiDraftsService } from '../../ai/ai-drafts.service';
import { ZodPipe } from '../../common/http';
import { Actor, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';

/**
 * AI drafts (CLAUDE.md §6): POST because each call is audited and spends tokens; nothing is saved —
 * the permission is that of the field the draft fills.
 */
@AdminController('ai')
export class AdminAiController {
  constructor(private readonly ai: AiDraftsService) {}

  @Post('product-description')
  @HttpCode(200)
  @RequirePermissions('products.edit')
  product(
    @Body(new ZodPipe(aiProductDraftSchema)) body: AiProductDraftInput,
    @Actor() actor: AuditActor,
  ): Promise<AiProductDescriptionDraftDto> {
    return this.ai.productDescription(actor, body.productId, body.hint);
  }

  @Post('seo')
  @HttpCode(200)
  @RequirePermissions('seo.edit')
  seo(
    @Body(new ZodPipe(aiSeoDraftSchema)) body: AiSeoDraftInput,
    @Actor() actor: AuditActor,
  ): Promise<AiSeoDraftDto> {
    return this.ai.seo(actor, body.path);
  }

  /** Any staff: whether the AI buttons can work (no secrets). */
  @Get('status')
  @RequirePermissions('dashboard.view')
  status(): Promise<AiDraftStatusDto> {
    return this.ai.status();
  }

  /** Owner (`integrations.keys`): operator reply drafts on/off — off by default (data leaves UZ). */
  @Put('settings')
  @RequirePermissions('integrations.view', 'integrations.keys')
  settings(
    @Body(new ZodPipe(aiSettingsSchema)) body: AiSettingsInput,
    @Actor() actor: AuditActor,
  ): Promise<AiDraftStatusDto> {
    return this.ai.setReplyDrafts(actor, body.replyDrafts);
  }

  @Post('reply')
  @HttpCode(200)
  @RequirePermissions('bot.inbox')
  reply(
    @Body(new ZodPipe(aiReplyDraftSchema)) body: AiReplyDraftInput,
    @Actor() actor: AuditActor,
  ): Promise<AiReplyDraftDto> {
    return this.ai.reply(actor, body.conversationId, body.locale);
  }
}
