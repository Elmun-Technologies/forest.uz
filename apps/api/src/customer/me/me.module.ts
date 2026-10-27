import { Module } from '@nestjs/common';
import { CatalogModule } from '../../catalog/catalog.module';
import { CustomerCommonModule } from '../common/customer-common.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [CatalogModule, CustomerCommonModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
