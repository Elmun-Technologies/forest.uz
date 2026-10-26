import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { cartMergerProvider } from '../cart-merger';
import { CustomerCommonModule } from '../common/customer-common.module';
import { MeModule } from '../me/me.module';
import { AuthController } from './auth.controller';
import { OtpService } from './otp.service';

@Module({
  imports: [CommerceModule, CustomerCommonModule, MeModule],
  controllers: [AuthController],
  providers: [OtpService, cartMergerProvider],
})
export class AuthModule {}
