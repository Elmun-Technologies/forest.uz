import { Body, Controller, Header, HttpCode, Param, Post } from '@nestjs/common';
import { EskizCallbackService } from './eskiz-callback.service';

/**
 * `POST /v1/webhooks/eskiz/:token` — SMS delivery status (JSON or form body). 200 for every
 * authenticated request, so Eskiz doesn't retry callbacks we chose to ignore.
 */
@Controller('webhooks/eskiz')
export class EskizWebhookController {
  constructor(private readonly callbacks: EskizCallbackService) {}

  @Post(':token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async status(@Param('token') token: string, @Body() body: unknown): Promise<{ ok: true }> {
    await this.callbacks.handle(token, body);
    return { ok: true };
  }
}
