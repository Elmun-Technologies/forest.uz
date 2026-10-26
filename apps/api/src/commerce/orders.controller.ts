import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  changeAddressSchema,
  type CheckoutInput,
  type CheckoutResultDto,
  checkoutSchema,
  DomainError,
  type Locale,
  type OrderPublicDto,
  type TrackingDto,
} from '@forest/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ReqLocale, ZodPipe } from '../common/http';
import { SessionService } from '../common/session';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { deviceHash } from './cart.controller';
import { CheckoutService } from './checkout.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrdersService } from './orders.service';

/** Signed, short-lived proof that this browser placed the order (shows full contact on the order page). */
const ORDER_COOKIE = 'fr_ord';
const IDEMPOTENCY_KEY = /^[\w-]{16,80}$/;

async function viewerFor(
  req: Request,
  sessions: SessionService,
  publicId?: string,
): Promise<{ customerId: string | null; placedHere: boolean }> {
  const session = await sessions.read(req);
  const signed = (req.signedCookies as Record<string, unknown> | undefined)?.[ORDER_COOKIE];
  return {
    customerId: session?.customerId ?? null,
    placedHere: Boolean(publicId && signed === publicId),
  };
}

@Controller()
export class OrdersController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly orders: OrdersService,
    private readonly sessions: SessionService,
  ) {}

  @Post('checkout/orders')
  @Header('Cache-Control', 'no-store')
  async place(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodPipe(checkoutSchema)) body: CheckoutInput,
    @ReqLocale() locale: Locale,
  ): Promise<CheckoutResultDto> {
    const key = req.header('idempotency-key');
    if (!key || !IDEMPOTENCY_KEY.test(key)) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED');
    const result = await this.checkout.placeIdempotent(req, key, body, locale, deviceHash(req));
    res.cookie(ORDER_COOKIE, result.publicId, {
      ...this.sessions.cookieOptions(24 * 3600),
      signed: true,
    });
    return result;
  }

  @Get('orders/:publicId')
  @Header('Cache-Control', 'no-store')
  async get(
    @Req() req: Request,
    @Param('publicId') publicId: string,
    @ReqLocale() locale: Locale,
  ): Promise<OrderPublicDto> {
    const viewer = await viewerFor(req, this.sessions, publicId);
    return this.orders.byPublicId(
      publicId,
      locale,
      (owner) => viewer.placedHere || viewer.customerId === owner,
    );
  }

  @Post('orders/:publicId/pay')
  @Header('Cache-Control', 'no-store')
  async retry(
    @Param('publicId') publicId: string,
    @Body(new ZodPipe(z.object({ method: z.enum(['PAYME', 'CLICK']) })))
    body: { method: 'PAYME' | 'CLICK' },
    @ReqLocale() locale: Locale,
  ): Promise<{ url: string }> {
    return this.checkout.retryPayment(publicId, body.method, locale);
  }

  @Get('track/:token')
  @Header('Cache-Control', 'no-store')
  async track(
    @Req() req: Request,
    @Param('token') token: string,
    @ReqLocale() locale: Locale,
  ): Promise<TrackingDto> {
    const viewer = await viewerFor(req, this.sessions);
    return this.orders.tracking(token, locale, viewer.customerId);
  }

  @Patch('track/:token/address')
  async changeAddress(
    @Req() req: Request,
    @Param('token') token: string,
    @Body(new ZodPipe(changeAddressSchema)) body: z.infer<typeof changeAddressSchema>,
  ): Promise<{ ok: true }> {
    const viewer = await viewerFor(req, this.sessions);
    await this.orders.changeAddress(
      token,
      viewer.customerId,
      body.addressLine,
      body.district ?? null,
    );
    return { ok: true };
  }

  @Get('me/orders')
  @Header('Cache-Control', 'no-store')
  async mine(@Req() req: Request, @ReqLocale() locale: Locale): Promise<OrderPublicDto[]> {
    const viewer = await viewerFor(req, this.sessions);
    if (!viewer.customerId) throw new DomainError('UNAUTHORIZED');
    return this.orders.forCustomer(viewer.customerId, locale);
  }
}

/**
 * Fake payment provider callback (PROVIDERS_MODE=fake only): the storefront's /fake-pay page posts
 * here to simulate the Payme/Click webhook, exercising the same OrderLifecycleService path.
 */
@Controller('dev/fake-pay')
export class FakePayController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  async complete(
    @Body(
      new ZodPipe(
        z.object({ order: z.string().min(8).max(32), result: z.enum(['success', 'fail']) }),
      ),
    )
    body: {
      order: string;
      result: 'success' | 'fail';
    },
  ): Promise<{ ok: true; publicId: string }> {
    if (!this.integrations.fakeMode) throw new NotFoundException();
    const order = await this.prisma.order.findUnique({
      where: { publicId: body.order },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const payment = order?.payments[0];
    if (!order || !payment || payment.method === 'COD') throw new DomainError('ORDER_NOT_FOUND');
    const provider = { type: 'PAYMENT_PROVIDER' as const, id: payment.method.toLowerCase() };
    if (body.result === 'success')
      await this.lifecycle.markPaid(payment.id, provider, `fake-${payment.id}`);
    else await this.lifecycle.markFailed(payment.id, provider, 'fake_declined');
    return { ok: true, publicId: order.publicId };
  }
}
