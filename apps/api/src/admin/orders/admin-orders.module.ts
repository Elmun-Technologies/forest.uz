import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { DeliveryModule } from '../../delivery/delivery.module';
import { AdminOrderActionsService } from './admin-order-actions.service';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';

/** A6/A7 admin orders: reads, actions, manual phone orders, CSV export. */
@Module({
  imports: [CommerceModule, DeliveryModule],
  controllers: [AdminOrdersController],
  providers: [AdminOrdersService, AdminOrderActionsService],
})
export class AdminOrdersModule {}
