import { Module } from '@nestjs/common';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminSettingsService } from './admin-settings.service';

/** `/v1/admin/settings/{store,delivery}` (A16). Staff and audit tabs live in their own modules. */
@Module({ controllers: [AdminSettingsController], providers: [AdminSettingsService] })
export class AdminSettingsModule {}
