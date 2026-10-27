import { Module } from '@nestjs/common';
import { EskizCallbackService } from './eskiz-callback.service';
import { EskizWebhookController } from './eskiz-webhook.controller';

/** Inbound messaging-provider webhooks (Eskiz delivery reports; Telegram bot in Phase 5). */
@Module({
  controllers: [EskizWebhookController],
  providers: [EskizCallbackService],
})
export class MessagingModule {}
