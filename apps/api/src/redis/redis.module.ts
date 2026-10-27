import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

@Injectable()
export class RedisService extends Redis implements OnApplicationShutdown {
  constructor(@Inject(ENV) env: Env) {
    // maxRetriesPerRequest: null is required by BullMQ for blocking connections.
    super(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  }

  // After `WorkerShutdown` (beforeApplicationShutdown): running jobs keep Redis until they end.
  async onApplicationShutdown(): Promise<void> {
    await this.quit().catch(() => undefined);
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
