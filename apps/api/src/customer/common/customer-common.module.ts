import { Module } from '@nestjs/common';
import { ConsentsService } from './consents';
import { TemplateSms } from './messaging';
import { ProductCards } from './product-cards';
import { RateLimiter } from './rate-limit';

/** Building blocks shared by the customer-facing modules. */
@Module({
  providers: [RateLimiter, TemplateSms, ConsentsService, ProductCards],
  exports: [RateLimiter, TemplateSms, ConsentsService, ProductCards],
})
export class CustomerCommonModule {}
