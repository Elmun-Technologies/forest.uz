import { Body, Get, Module, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type AdminBotConversationDto,
  type AdminBotConversationListDto,
  type AdminBotOverviewDto,
  type AdminVariantOptionDto,
  type BotConversationListQuery,
  botConversationListQuerySchema,
  type BotConversationPatchInput,
  botConversationPatchSchema,
  type BotReplyInput,
  botReplySchema,
  type BotRulesUpdateInput,
  botRulesUpdateSchema,
  type BotScenarioToggleInput,
  botScenarioToggleSchema,
} from '@forest/contracts';
import { z } from 'zod';
import { ZodPipe } from '../../common/http';
import { Actor, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import { AdminBotService } from './admin-bot.service';

const botVariantSearchSchema = z.object({ q: z.string().max(64).default('') });

/**
 * A12 Telegram bot (CLAUDE.md §6, 5A). Overview, scenarios and complaint keywords: `bot.edit`
 * (O/M/Mk). Operator inbox: `bot.inbox` (O/M/Op). Templates are 5B's `/admin/messaging/*`.
 */
@AdminController('bot')
export class AdminBotController {
  constructor(private readonly bot: AdminBotService) {}

  @Get('overview')
  @RequirePermissions('bot.edit')
  overview(): Promise<AdminBotOverviewDto> {
    return this.bot.overview();
  }

  @Put('scenarios')
  @RequirePermissions('bot.edit')
  async scenario(
    @Actor() actor: AuditActor,
    @Body(new ZodPipe(botScenarioToggleSchema)) body: BotScenarioToggleInput,
  ): Promise<AdminBotOverviewDto> {
    await this.bot.toggleScenario(actor, body);
    return this.bot.overview();
  }

  @Put('rules')
  @RequirePermissions('bot.edit')
  async rules(
    @Actor() actor: AuditActor,
    @Body(new ZodPipe(botRulesUpdateSchema)) body: BotRulesUpdateInput,
  ): Promise<AdminBotOverviewDto> {
    await this.bot.updateRules(actor, body);
    return this.bot.overview();
  }

  /** Sidebar badge: new + complaint conversations. */
  @Get('inbox-count')
  @RequirePermissions('bot.inbox')
  async inboxCount(): Promise<{ count: number }> {
    return { count: await this.bot.inboxCount() };
  }

  @Get('variants')
  @RequirePermissions('bot.inbox')
  variants(
    @Query(new ZodPipe(botVariantSearchSchema)) q: { q: string },
  ): Promise<AdminVariantOptionDto[]> {
    return this.bot.variants(q.q);
  }

  @Get('conversations')
  @RequirePermissions('bot.inbox')
  list(
    @Query(new ZodPipe(botConversationListQuerySchema)) q: BotConversationListQuery,
  ): Promise<AdminBotConversationListDto> {
    return this.bot.list(q);
  }

  @Get('conversations/:id')
  @RequirePermissions('bot.inbox')
  detail(@Param('id') id: string): Promise<AdminBotConversationDto> {
    return this.bot.detail(id);
  }

  @Post('conversations/:id/reply')
  @RequirePermissions('bot.inbox')
  reply(
    @Actor() actor: AuditActor,
    @Param('id') id: string,
    @Body(new ZodPipe(botReplySchema)) body: BotReplyInput,
  ): Promise<AdminBotConversationDto> {
    return this.bot.reply(actor, id, body);
  }

  @Patch('conversations/:id')
  @RequirePermissions('bot.inbox')
  patch(
    @Actor() actor: AuditActor,
    @Param('id') id: string,
    @Body(new ZodPipe(botConversationPatchSchema)) body: BotConversationPatchInput,
  ): Promise<AdminBotConversationDto> {
    return this.bot.patch(actor, id, body);
  }
}

@Module({ controllers: [AdminBotController], providers: [AdminBotService] })
export class AdminBotModule {}
