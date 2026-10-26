import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import { ClickShopService } from './click-shop.service';
import { PaymentWebhooksController } from './payments.controller';
import { PaymeMerchantService } from './payme-merchant.service';

/** Payme Merchant API and Click SHOP API webhooks (docs/06, docs/runbooks/payments.md). */
@Module({
  imports: [CommerceModule],
  controllers: [PaymentWebhooksController],
  providers: [PaymeMerchantService, ClickShopService],
})
export class PaymentsModule {}
