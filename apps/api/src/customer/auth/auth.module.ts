import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { cartMergerProvider } from '../cart-merger';
import { CustomerCommonModule } from '../common/customer-common.module';
import { MeModule } from '../me/me.module';
import { AuthController, TelegramLinkController } from './auth.controller';
import { CustomerSignIn } from './customer-sign-in.service';
import { DevAuthController } from './dev-auth.controller';
import { OtpService } from './otp.service';
import { TelegramAuthService } from './telegram-auth.service';

@Module({
  imports: [CommerceModule, CustomerCommonModule, MeModule],
  controllers: [AuthController, TelegramLinkController, DevAuthController],
  providers: [OtpService, TelegramAuthService, CustomerSignIn, cartMergerProvider],
  // The bot links Telegram-verified phones to accounts the same way (5A).
  exports: [TelegramAuthService],
})
export class AuthModule {}
