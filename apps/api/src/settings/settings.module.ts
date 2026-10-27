import { Controller, Get, Global, Header, Module } from '@nestjs/common';
import type { PublicSettingsDto } from '@forest/contracts';
import { SettingsService } from './settings.service';

@Controller('settings')
export class PublicSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('public')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  get(): Promise<PublicSettingsDto> {
    return this.settings.publicSettings();
  }
}

@Global()
@Module({
  controllers: [PublicSettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
