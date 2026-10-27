import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Update } from 'grammy/types';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { assertDevEndpoints, DevEndpointsGuard } from '../common/dev-endpoints';
import { ZodPipe } from '../common/http';
import { visitorId } from '../common/session';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { RateLimiter } from '../customer/common/rate-limit';
import { BotUpdatesService } from './bot-updates.service';
import { CartLinkService } from './cart-link.service';
import { fakeUpdates } from './fake-telegram';
import { type CartRestoreResult, CartRestoreService } from './cart-restore.service';
import { StartLinksService } from './start-links.service';
import { TelegramGateway } from './telegram-gateway.service';

/**
 * `POST /v1/webhooks/telegram/:secret` — Bot API updates (CLAUDE.md §6, 5A). Path secret and the
 * `X-Telegram-Bot-Api-Secret-Token` header must both equal the connected integration's
 * `webhookSecret`, else 404. Updates are handled in-request so one chat's messages keep their
 * order (Telegram waits for the answer before sending that chat's next update); a failing handler
 * answers 500 so Telegram retries (the update's dedupe key is released).
 */
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(
    private readonly gateway: TelegramGateway,
    private readonly updates: BotUpdatesService,
  ) {}

  @Post(':secret')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async update(
    @Param('secret') secret: string,
    @Headers('x-telegram-bot-api-secret-token') header: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const config = await this.gateway.authenticate(secret, header);
    if (!config) throw new NotFoundException();
    const update = body as Partial<Update> | null;
    if (update && typeof update.update_id === 'number')
      await this.updates.handle(config, update as Update);
    return { ok: true };
  }
}

const startLinkSchema = z.object({
  src: z
    .string()
    .regex(/^[a-z0-9_]{1,16}$/)
    .default('site'),
});
const restoreSchema = z.object({ token: z.string().min(10).max(2000) });

/** Storefront helpers: site → bot start links, bot → site cart restore. */
@Controller()
export class BotPublicController {
  constructor(
    private readonly starts: StartLinksService,
    private readonly restores: CartRestoreService,
    private readonly limiter: RateLimiter,
  ) {}

  /** `/tg?s=<src>` route on the storefront: never creates a visitor id (crawlers have none). */
  @Post('bot/start-link')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async startLink(
    @Body(new ZodPipe(startLinkSchema)) body: z.infer<typeof startLinkSchema>,
    @Req() req: Request,
  ): Promise<{ url: string | null }> {
    await this.limiter.consume('tg-start:ip', req.ip ?? 'unknown', 30, 60);
    return { url: await this.starts.startUrl(body.src, visitorId(req)) };
  }

  @Post('cart/restore')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async restore(
    @Body(new ZodPipe(restoreSchema)) body: z.infer<typeof restoreSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartRestoreResult> {
    await this.limiter.consume('cart-restore:ip', req.ip ?? 'unknown', 20, 60);
    return this.restores.restore(req, res, body.token);
  }
}

const devCartLinkSchema = z.object({
  cartId: z.string().min(1).optional(),
  lines: z
    .array(z.object({ variantId: z.string().min(1), qty: z.number().int().min(1) }))
    .optional(),
  promo: z.string().optional(),
  locale: z.enum(['uz', 'ru']).optional(),
});

const devUpdateSchema = z.object({
  chatId: z.number().int().positive(),
  text: z.string().max(4000).optional(),
  firstName: z.string().max(64).optional(),
  callback: z.string().max(64).optional(),
});

/**
 * Dev/e2e only (DEV_ENDPOINTS + fake mode): mint cart restore links, simulate a customer's
 * Telegram update (text or button press) through the real handlers, and read what the fake
 * transport sent to a chat.
 */
@Controller('dev/bot')
@UseGuards(DevEndpointsGuard)
export class DevBotController {
  constructor(
    private readonly links: CartLinkService,
    private readonly gateway: TelegramGateway,
    private readonly updates: BotUpdatesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('update')
  @HttpCode(200)
  async update(
    @Body(new ZodPipe(devUpdateSchema)) body: z.infer<typeof devUpdateSchema>,
  ): Promise<{ ok: true }> {
    assertDevEndpoints(this.env);
    const config = await this.gateway.config();
    if (!config?.fake) throw new NotFoundException();
    const update = body.callback
      ? fakeUpdates.callback(body.chatId, body.callback)
      : fakeUpdates.text(body.chatId, body.text ?? '/start', { firstName: body.firstName });
    await this.updates.handle(config, update);
    return { ok: true };
  }

  @Get('sent')
  sent(@Query('chatId') chatId: string): { method: string; text: string }[] {
    assertDevEndpoints(this.env);
    return this.gateway.fake
      .sent(chatId)
      .map((c) => ({ method: c.method, text: String(c.payload.text ?? c.payload.caption ?? '') }));
  }

  @Post('cart-link')
  @HttpCode(200)
  cartLink(@Body(new ZodPipe(devCartLinkSchema)) body: z.infer<typeof devCartLinkSchema>): {
    url: string;
  } {
    assertDevEndpoints(this.env);
    return {
      url: body.cartId
        ? this.links.restoreUrl({
            cartId: body.cartId,
            promo: body.promo,
            campaign: 'abandoned_cart',
            locale: body.locale,
          })
        : this.links.addLinesUrl(body.lines ?? []),
    };
  }
}
