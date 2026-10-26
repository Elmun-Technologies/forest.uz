import {
  Controller,
  Delete,
  Get,
  Global,
  Inject,
  Module,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { IntegrationsService } from './integrations.service';
import type { OutboxMessage } from './providers/fake';

/**
 * Dev-only: messages captured by fake SMS/Telegram providers (OTP codes for local login and
 * e2e tests). Returns 404 unless PROVIDERS_MODE=fake and NODE_ENV != production.
 */
@Controller('dev/outbox')
export class DevOutboxController {
  constructor(
    private readonly integrations: IntegrationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private guard(): void {
    if (this.env.NODE_ENV === 'production' || this.env.PROVIDERS_MODE !== 'fake')
      throw new NotFoundException();
  }

  @Get()
  list(@Query('to') to?: string): OutboxMessage[] {
    this.guard();
    return this.integrations.outbox.list(to);
  }

  @Delete()
  clear(): { ok: true } {
    this.guard();
    this.integrations.outbox.clear();
    return { ok: true };
  }
}

@Global()
@Module({
  controllers: [DevOutboxController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
