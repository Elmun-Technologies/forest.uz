import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CatalogModule } from './catalog/catalog.module';
import { PINO_REDACT_PATHS } from './common/redact';
import { ConfigModule, ENV } from './config/config.module';
import type { Env } from './config/env';
import { FilesModule } from './files/files.service';
import { HealthModule } from './health/health.controller';
import { IntegrationsModule } from './integrations/integrations.module';
import { JobsModule } from './jobs/jobs.module';
import { PrismaModule } from './prisma/prisma.service';
import { RedisModule } from './redis/redis.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          redact: { paths: PINO_REDACT_PATHS, censor: '[redacted]' },
          // Query strings may carry tokens (tracking links); log path only.
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              path: req.url.split('?')[0],
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          autoLogging: {
            ignore: (req: { url?: string }) => req.url === '/health' || req.url === '/ready',
          },
          transport:
            env.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    PrismaModule,
    RedisModule,
    FilesModule,
    SettingsModule,
    IntegrationsModule,
    HealthModule,
    CatalogModule,
    JobsModule,
  ],
})
export class AppModule {}
