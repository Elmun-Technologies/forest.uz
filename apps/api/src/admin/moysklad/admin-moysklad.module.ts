import { Module } from '@nestjs/common';
import { MoyskladModule } from '../../moysklad/moysklad.module';
import { AdminMoyskladController } from './admin-moysklad.controller';
import { AdminMoyskladService } from './admin-moysklad.service';

/** `/v1/admin/moysklad/*` (A13). */
@Module({
  imports: [MoyskladModule],
  controllers: [AdminMoyskladController],
  providers: [AdminMoyskladService],
})
export class AdminMoyskladModule {}
