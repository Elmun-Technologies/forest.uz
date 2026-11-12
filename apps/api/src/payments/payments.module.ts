import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import {
  ClickFiscalService,
  PAYMENTS_QUEUE,
  PaymentsProcessor,
  PaymentsScheduler,
} from './click-fiscal.service';
import { ClickShopService } from './click-shop.service';
import { PaymentWebhooksController } from './payments.controller';
import { PaymeMerchantService } from './payme-merchant.service';

/**
 * Payme Merchant API and Click SHOP API webhooks, plus Click fiscalization (queue `payments`)
 * — docs/06, docs/runbooks/payments.md.
 */
@Module({
  imports: [CommerceModule, BullModule.registerQueue({ name: PAYMENTS_QUEUE })],
  controllers: [PaymentWebhooksController],
  providers: [
    PaymeMerchantService,
    ClickShopService,
    ClickFiscalService,
    PaymentsProcessor,
    PaymentsScheduler,
  ],
  exports: [ClickFiscalService],
})
export class PaymentsModule {}
