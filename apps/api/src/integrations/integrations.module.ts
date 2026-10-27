import {
  Controller,
  Delete,
  Get,
  Global,
  Headers,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  NotFoundException,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DevEndpointsGuard, DevPublic, devTokenOk } from '../common/dev-endpoints';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { IntegrationsService } from './integrations.service';
import type { OutboxMessage } from './providers/fake';

/** Without the dev token, `?to=` returns only that phone's OTP messages of the last 5 minutes. */
const PUBLIC_OTP_WINDOW_MS = 5 * 60_000;

/**
 * Dev-only: messages captured by fake SMS/Telegram providers (OTP codes for local login and
 * e2e tests). 404 unless DEV_ENDPOINTS=true and PROVIDERS_MODE=fake. With `X-Dev-Token`: every
 * message (optionally `?to=`) and DELETE. Without it (demo testers): only the narrow OTP lookup —
 * one phone, `otp` template, last 5 minutes; no listing.
 */
@Controller('dev/outbox')
@UseGuards(DevEndpointsGuard)
export class DevOutboxController {
  constructor(
    private readonly integrations: IntegrationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @DevPublic()
  list(@Query('to') to?: string, @Headers('x-dev-token') token?: string): OutboxMessage[] {
    if (devTokenOk(this.env, token)) return this.integrations.outbox.list(to);
    // An unencoded `+` arrives as a space: accept `?to=998…` and `?to=+998…` alike.
    const phone = typeof to === 'string' ? `+${to.trim().replace(/^\+/, '')}` : '';
    if (!/^\+\d{9,15}$/.test(phone)) throw new NotFoundException();
    const since = Date.now() - PUBLIC_OTP_WINDOW_MS;
    return this.integrations.outbox
      .list(phone)
      .filter((m) => m.templateKey === 'otp' && m.at.getTime() >= since);
  }

  @Delete()
  clear(): { ok: true } {
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
export class IntegrationsModule implements OnApplicationBootstrap {
  constructor(@Inject(ENV) private readonly env: Env) {}

  onApplicationBootstrap(): void {
    if (this.env.DEV_ENDPOINTS && this.env.PROVIDERS_MODE === 'fake')
      new Logger('DevEndpoints').warn(
        `DEV ENDPOINTS ARE ON (NODE_ENV=${this.env.NODE_ENV}): GET /v1/dev/outbox?to= publishes OTP codes ` +
          `(everything else needs X-Dev-Token${this.env.DEV_ENDPOINTS_TOKEN ? '' : ': none set'}) ` +
          'and /v1/dev/fake-pay marks orders paid. Never expose this instance to real customers.',
      );
  }
}
