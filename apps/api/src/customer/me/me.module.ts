import { Module } from '@nestjs/common';
import { CustomerCommonModule } from '../common/customer-common.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [CustomerCommonModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
