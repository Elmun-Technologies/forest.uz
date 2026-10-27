import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { BullModule } from '@nestjs/bullmq';
import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { CustomerCommonModule } from '../customer/common/customer-common.module';
import { DeliveryQuoteModule } from '../delivery/delivery-quote.service';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CheckoutService } from './checkout.service';
import { FiscalService } from './fiscal.service';
import { NotificationsService } from './notifications.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { FakePayController, OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PromoService } from './promo.service';
import { ReservationsService } from './reservations.service';

const ORDERS_QUEUE = 'orders';
const EXPIRE = 'orders.reservations.expire';
const REMIND = 'orders.payment.remind';

/**
 * Every minute: releases unpaid online reservations (30 min) and unconfirmed COD holds (24 h);
 * reminds unpaid online orders once (`paymentReminderMinutes`).
 */
@Processor(ORDERS_QUEUE)
export class OrdersProcessor extends WorkerHost {
  constructor(private readonly lifecycle: OrderLifecycleService) {
    super();
  }

  async process(job: Job): Promise<number> {
    return job.name === REMIND ? this.lifecycle.remindUnpaid() : this.lifecycle.expireStale();
  }
}

@Injectable()
export class OrdersScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(ORDERS_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(EXPIRE, { every: 60_000 }, { name: EXPIRE });
    await this.queue.upsertJobScheduler(REMIND, { every: 60_000 }, { name: REMIND });
  }
}

/** Cart, delivery quote, checkout, orders, tracking, reservations. */
@Module({
  imports: [
    BullModule.registerQueue({ name: ORDERS_QUEUE }),
    CustomerCommonModule,
    DeliveryQuoteModule,
  ],
  controllers: [CartController, OrdersController, FakePayController],
  providers: [
    CartService,
    PromoService,
    ReservationsService,
    NotificationsService,
    OrderLifecycleService,
    FiscalService,
    CheckoutService,
    OrdersService,
    OrdersProcessor,
    OrdersScheduler,
  ],
  exports: [
    CartService,
    CheckoutService,
    OrdersService,
    OrderLifecycleService,
    NotificationsService,
    FiscalService,
  ],
})
export class CommerceModule {}
