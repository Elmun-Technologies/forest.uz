import { Body, HttpCode, Post } from '@nestjs/common';
import {
  type AiProductDescriptionDraftDto,
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
