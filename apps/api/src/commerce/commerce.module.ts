import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { BullModule } from '@nestjs/bullmq';
import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CheckoutService } from './checkout.service';
import { NotificationsService } from './notifications.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { FakePayController, OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PromoService } from './promo.service';
import { ReservationsService } from './reservations.service';

const ORDERS_QUEUE = 'orders';
const EXPIRE = 'orders.reservations.expire';

/** Releases unpaid online reservations (30 min) and unconfirmed COD holds (24 h) every minute. */
@Processor(ORDERS_QUEUE)
export class OrdersProcessor extends WorkerHost {
  constructor(private readonly lifecycle: OrderLifecycleService) {
    super();
  }

  async process(): Promise<number> {
    return this.lifecycle.expireStale();
  }
}

@Injectable()
export class OrdersScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(ORDERS_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(EXPIRE, { every: 60_000 }, { name: EXPIRE });
  }
}

/** Cart, delivery quote, checkout, orders, tracking, reservations. */
@Module({
  imports: [BullModule.registerQueue({ name: ORDERS_QUEUE })],
  controllers: [CartController, OrdersController, FakePayController],
  providers: [
    CartService,
    PromoService,
    ReservationsService,
    NotificationsService,
    OrderLifecycleService,
    CheckoutService,
    OrdersService,
    OrdersProcessor,
    OrdersScheduler,
  ],
  exports: [CartService, OrdersService, OrderLifecycleService, NotificationsService],
})
export class CommerceModule {}
