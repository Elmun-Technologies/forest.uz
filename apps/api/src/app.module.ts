import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { CatalogModule } from './catalog/catalog.module';
import { CommerceModule } from './commerce/commerce.module';
import { CustomerModule } from './customer/customer.module';
import { DeliveryModule } from './delivery/delivery.module';
import { PINO_REDACT_PATHS, serializeRequestForLog } from './common/redact';
import { SessionModule } from './common/session';
import { ConfigModule, ENV } from './config/config.module';
import type { Env } from './config/env';
import { FilesModule } from './files/files.service';
import { HealthModule } from './health/health.controller';
import { IntegrationsModule } from './integrations/integrations.module';
import { JobsModule } from './jobs/jobs.module';
import { MessagingModule } from './messaging/messaging.module';
import { PaymentsModule } from './payments/payments.module';
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
          // Query strings and some path segments carry secrets; log the masked path only.
          serializers: {
            req: serializeRequestForLog,
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
    SessionModule,
    FilesModule,
    SettingsModule,
    IntegrationsModule,
    HealthModule,
    CatalogModule,
    CommerceModule,
    CustomerModule,
    PaymentsModule,
    MessagingModule,
    DeliveryModule,
    JobsModule,
    AdminModule,
  ],
})
export class AppModule {}
