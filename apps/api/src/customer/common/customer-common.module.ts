import { Module } from '@nestjs/common';
import { ConsentsService } from './consents';
import { TemplateSms } from './messaging';
import { RateLimiter } from './rate-limit';

/** Building blocks shared by the customer-facing modules. */
@Module({
  providers: [RateLimiter, TemplateSms, ConsentsService],
  exports: [RateLimiter, TemplateSms, ConsentsService],
})
export class CustomerCommonModule {}
