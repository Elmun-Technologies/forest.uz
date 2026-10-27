import { Module } from '@nestjs/common';
import { CustomerCommonModule } from '../../customer/common/customer-common.module';
import { MeModule } from '../../customer/me/me.module';
import { AdminUploadService } from '../files/upload.service';
import { CustomerEraseService } from './customer-erase.service';
import { AdminCustomersController } from './customers.controller';
import { AdminCustomersService } from './customers.service';

/** `/v1/admin/customers` (A4/A5). */
@Module({
  imports: [CustomerCommonModule, MeModule],
  controllers: [AdminCustomersController],
  providers: [AdminCustomersService, CustomerEraseService, AdminUploadService],
})
export class AdminCustomersModule {}
