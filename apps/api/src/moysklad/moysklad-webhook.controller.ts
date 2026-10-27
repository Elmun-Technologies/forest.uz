import { Body, Controller, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { parseWebhookBody } from '../integrations/providers/moysklad';
import { MoyskladJobs } from './moysklad-jobs.service';
import { MoyskladLogService } from './moysklad-log.service';
import { MoyskladSettingsService } from './moysklad-settings.service';

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * MoySklad entity/stock webhooks (unsigned — CLAUDE.md §6). The secret path token authenticates
 * the caller; the body only says *what* to re-read, which jobs fetch from the API. Answers 200
 * quickly; unknown token or a disconnected integration → 404.
 */
@Controller('webhooks/moysklad')
export class MoyskladWebhookController {
  constructor(
    private readonly settings: MoyskladSettingsService,
    private readonly jobs: MoyskladJobs,
    private readonly log: MoyskladLogService,
  ) {}

  @Post(':token')
  @HttpCode(200)
  async receive(@Param('token') token: string, @Body() body: unknown): Promise<{ ok: true }> {
    const expected = await this.settings.webhookToken();
    if (!expected || !safeEqual(token, expected)) throw new NotFoundException();
    const { settings } = await this.settings.state();
    if (!settings.flows.webhooks) return { ok: true };
    const { events, stock } = parseWebhookBody(body);
    const unique = new Map(events.map((e) => [`${e.type}:${e.externalId}`, e]));
    if (settings.flows.products)
      for (const e of [...unique.values()].slice(0, 200))
        await this.jobs.enqueueItem(e.type, e.externalId);
    if (stock && settings.flows.stock) await this.jobs.enqueueStockRefresh();
    if (unique.size || stock)
      await this.log.log(
        'webhook',
        true,
        `Webhook: ${unique.size} ta pozitsiya${stock ? ', qoldiq' : ''} → navbatga qo'yildi`,
      );
    return { ok: true };
  }
}
