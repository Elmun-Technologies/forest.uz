import { Module } from '@nestjs/common';
import { AiDraftsService } from '../../ai/ai-drafts.service';
import { RateLimiter } from '../../customer/common/rate-limit';
import { WebhooksOutModule } from '../../webhooks-out/webhooks.module';
import { AdminAiController } from '../ai/ai-admin.controller';
import { ContentAdminService } from '../content/content-admin.service';
import { AdminContentController } from '../content/content-admin.controller';
import { AdminUploadService } from '../files/upload.service';
import { AdminApiKeysController, AdminWebhooksController } from './automation-admin.controller';
import { ApiKeysAdminService } from './api-keys-admin.service';
import { WebhooksAdminService } from './webhooks-admin.service';

/** Phase 5C admin: outbound webhooks, API keys, Ilhom/Brend CMS and AI drafts. */
@Module({
  imports: [WebhooksOutModule],
  controllers: [
    AdminWebhooksController,
    AdminApiKeysController,
    AdminContentController,
    AdminAiController,
  ],
  providers: [
    WebhooksAdminService,
    ApiKeysAdminService,
    ContentAdminService,
    AdminUploadService,
    AiDraftsService,
    RateLimiter,
  ],
})
export class AdminAutomationModule {}
