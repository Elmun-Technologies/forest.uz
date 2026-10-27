import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service';
import { eskizCallbackTokenMatches, parseEskizCallback } from '../integrations/providers/eskiz';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { applyEskizStatus, parkEskizStatus } from './eskiz-status';

export type EskizCallbackResult = 'updated' | 'unchanged' | 'unknown' | 'ignored';

/**
 * Eskiz delivery-status callback (`callback_url` of every send). Eskiz signs nothing, so the
 * request is authenticated by the per-install secret in the URL (CLAUDE.md §6).
 */
@Injectable()
export class EskizCallbackService {
  private readonly logger = new Logger('EskizCallback');

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly redis: RedisService,
  ) {}

  async handle(token: string, body: unknown): Promise<EskizCallbackResult> {
    const creds = await this.integrations.connectedCredentials('eskiz');
    // Same answer for "not connected" and "wrong token": nothing to probe.
    if (!creds || !eskizCallbackTokenMatches(token, creds.callbackToken))
      throw new NotFoundException();

    const cb = parseEskizCallback(body);
    if (!cb) {
      await this.audit(false, 'unparseable callback', body);
      return 'ignored';
    }
    if (cb.outcome === 'PENDING') return 'unchanged';
    const final = { outcome: cb.outcome, status: cb.status };
    if ((await applyEskizStatus(this.prisma, cb.requestId, final)) > 0) {
      await this.audit(true, `${cb.status} → ${cb.outcome}`, body);
      return 'updated';
    }
    const known = await this.prisma.message.count({
      where: { channel: 'SMS', providerId: cb.requestId },
    });
    // Unknown ids are normal: OTP texts are not stored (secrets), and a callback may beat our
    // providerId write — parked, the sender applies it once the id is stored.
    if (!known) {
      this.logger.debug(`callback for unknown request ${cb.requestId}`);
      await parkEskizStatus(this.redis, cb.requestId, final);
    }
    return known ? 'unchanged' : 'unknown';
  }

  private async audit(ok: boolean, message: string, payload: unknown): Promise<void> {
    await this.integrations
      .log('eskiz', { direction: 'IN', kind: 'webhook.status', ok, message, payload })
      .catch((e: unknown) => this.logger.warn(`integration log failed: ${String(e)}`));
  }
}
