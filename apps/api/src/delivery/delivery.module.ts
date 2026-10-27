import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  Post,
  Query,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Job, Queue } from 'bullmq';
import { CommerceModule } from '../commerce/commerce.module';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { yandexCallbackKey } from '../integrations/providers/yandex-delivery';
import { DevShipmentController } from './dev-shipment.controller';
import { ManualShipmentService } from './manual-shipment.service';
import { YandexShipmentService } from './yandex-shipment.service';

export const DELIVERY_QUEUE = 'delivery';
export const SYNC_JOB = 'delivery.shipments.sync';
export const REFRESH_JOB = 'delivery.shipment.refresh';

/** Every minute: active Yandex claims that are due; on demand: one claim (status callback). */
@Processor(DELIVERY_QUEUE)
export class DeliveryProcessor extends WorkerHost {
  constructor(private readonly yandex: YandexShipmentService) {
    super();
  }

  async process(job: Job<{ shipmentId?: string }>): Promise<number> {
    if (job.name === REFRESH_JOB && job.data.shipmentId) {
      await this.yandex.refresh(job.data.shipmentId);
      return 1;
    }
    return this.yandex.syncDue();
  }
}

@Injectable()
export class DeliveryScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(DELIVERY_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(SYNC_JOB, { every: 60_000 }, { name: SYNC_JOB });
  }
}

/** Express parses `?a=1&a=2` into an array (and `a[x]=` into an object): take one string. */
export function firstString(v: unknown): string | undefined {
  const first: unknown = Array.isArray(v) ? v[0] : v;
  return typeof first === 'string' ? first : undefined;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Yandex claim status callback (`callback_properties.callback_url`). Yandex appends `claim_id`
 * and `updated_ts` to our URL and expects HTTP 200 (it retries otherwise). The callback is
 * unsigned, so it is only a trigger: the claim is re-read with claims/info in a queued job.
 */
@Controller('webhooks/yandex-delivery')
export class YandexDeliveryWebhookController {
  constructor(
    private readonly yandex: YandexShipmentService,
    @InjectQueue(DELIVERY_QUEUE) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post()
  @HttpCode(200)
  async callback(
    @Query('key') rawKey: unknown,
    @Query('claim_id') rawClaimId: unknown,
  ): Promise<{ ok: true }> {
    const key = firstString(rawKey);
    const claimId = firstString(rawClaimId);
    if (!key || !safeEqual(key, yandexCallbackKey(this.env.APP_ENCRYPTION_KEY)))
      throw new ForbiddenException();
    const shipmentId = claimId ? await this.yandex.shipmentIdForClaim(claimId.slice(0, 128)) : null;
    if (shipmentId)
      // One pending refresh per shipment: a burst of callbacks collapses into one claims/info.
      await this.queue.add(
        REFRESH_JOB,
        { shipmentId },
        { jobId: `refresh-${shipmentId}`, removeOnComplete: true, removeOnFail: true },
      );
    return { ok: true };
  }
}

/** Yandex claims (create/accept/sync/cancel) and the delivery queue. */
@Module({
  imports: [BullModule.registerQueue({ name: DELIVERY_QUEUE }), CommerceModule],
  controllers: [YandexDeliveryWebhookController, DevShipmentController],
  providers: [YandexShipmentService, ManualShipmentService, DeliveryProcessor, DeliveryScheduler],
  exports: [YandexShipmentService, ManualShipmentService],
})
export class DeliveryModule {}
