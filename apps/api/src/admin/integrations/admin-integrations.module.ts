import { Module } from '@nestjs/common';
import { AdminIntegrationsController } from './admin-integrations.controller';
import { AdminIntegrationsService } from './admin-integrations.service';

/** `/v1/admin/integrations` (A10). `IntegrationsService` is global. */
@Module({ controllers: [AdminIntegrationsController], providers: [AdminIntegrationsService] })
export class AdminIntegrationsModule {}
