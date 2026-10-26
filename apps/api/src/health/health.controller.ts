import { Controller, Get, HttpCode, Module, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness: process is up. */
  @Get('health')
  @HttpCode(200)
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable. */
  @Get('ready')
  async ready(): Promise<{ status: 'ok'; db: 'ok'; redis: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.redis.ping();
      return { status: 'ok', db: 'ok', redis: 'ok' };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
