import { Global, Module } from '@nestjs/common';
import { BotAlertsService } from './bot-alerts.service';
import { BotService } from './bot.service';
import { CartLinkService } from './cart-link.service';
import { TelegramGateway } from './telegram-gateway.service';

/**
 * Bot building blocks other domains use (CLAUDE.md §6, 5A): the transport, `BotService`
 * (messaging's `TelegramSender`), cart restore links (messaging's `CartLinks`) and admin alerts.
 * Global and free of domain imports, so commerce/messaging can inject them without cycles.
 */
@Global()
@Module({
  providers: [TelegramGateway, BotService, CartLinkService, BotAlertsService],
  exports: [TelegramGateway, BotService, CartLinkService, BotAlertsService],
})
export class BotCoreModule {}
