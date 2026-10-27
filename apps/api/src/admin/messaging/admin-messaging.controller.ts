import { Body, Delete, Get, HttpCode, Module, Param, Patch, Post, Put } from '@nestjs/common';
import {
  type AdminMessageTemplateDto,
  type MessageTemplateCreateInput,
  messageTemplateCreateSchema,
  type MessageTemplateTestInput,
  messageTemplateTestSchema,
  type MessageTemplateUpdateInput,
  messageTemplateUpdateSchema,
  type MessageTestResultDto,
  type MessagingSettingsDto,
  type MessagingSettingsInput,
  messagingSettingsInputSchema,
} from '@forest/contracts';
import { ZodPipe } from '../../common/http';
import { Actor, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import { AdminMessagingService } from './admin-messaging.service';

/** A12 messages: templates, test-to-myself, messaging settings — `bot.edit` (O/M/Mk). */
@AdminController('messaging')
export class AdminMessagingController {
  constructor(private readonly messaging: AdminMessagingService) {}

  @Get('templates')
  @RequirePermissions('bot.edit')
  templates(): Promise<AdminMessageTemplateDto[]> {
    return this.messaging.templates();
  }

  @Post('templates')
  @RequirePermissions('bot.edit')
  create(
    @Body(new ZodPipe(messageTemplateCreateSchema)) body: MessageTemplateCreateInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminMessageTemplateDto> {
    return this.messaging.create(actor, body);
  }

  @Patch('templates/:key')
  @RequirePermissions('bot.edit')
  update(
    @Param('key') key: string,
    @Body(new ZodPipe(messageTemplateUpdateSchema)) body: MessageTemplateUpdateInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminMessageTemplateDto> {
    return this.messaging.update(actor, key, body);
  }

  @Delete('templates/:key')
  @HttpCode(204)
  @RequirePermissions('bot.edit')
  async remove(@Param('key') key: string, @Actor() actor: AuditActor): Promise<void> {
    await this.messaging.remove(actor, key);
  }

  @Post('templates/:key/test')
  @RequirePermissions('bot.edit')
  test(
    @Param('key') key: string,
    @Body(new ZodPipe(messageTemplateTestSchema)) body: MessageTemplateTestInput,
    @Actor() actor: AuditActor,
  ): Promise<MessageTestResultDto> {
    return this.messaging.test(actor, key, body);
  }

  @Get('settings')
  @RequirePermissions('bot.edit')
  settings(): Promise<MessagingSettingsDto> {
    return this.messaging.getSettings();
  }

  @Put('settings')
  @RequirePermissions('bot.edit')
  saveSettings(
    @Body(new ZodPipe(messagingSettingsInputSchema)) body: MessagingSettingsInput,
    @Actor() actor: AuditActor,
  ): Promise<MessagingSettingsDto> {
    return this.messaging.saveSettings(actor, body);
  }
}

@Module({ controllers: [AdminMessagingController], providers: [AdminMessagingService] })
export class AdminMessagingModule {}
