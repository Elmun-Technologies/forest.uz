import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MeDto } from '@forest/contracts';
import type { Request, Response } from 'express';
import { SessionService, cartIdFromCookie, sessionId } from '../../common/session';
import { IdentityService } from '../../tracking/identity.service';
import { CART_MERGER, type CartMerger } from '../cart-merger';
import { MeService } from '../me/me.service';

/** The one way a verified customer gets a session (OTP, Telegram, dev login). */
@Injectable()
export class CustomerSignIn {
  private readonly logger = new Logger('CustomerAuth');

  constructor(
    private readonly sessions: SessionService,
    private readonly me: MeService,
    @Inject(CART_MERGER) private readonly carts: CartMerger,
    private readonly identity: IdentityService,
  ) {}

  async signIn(req: Request, res: Response, customerId: string): Promise<MeDto> {
    // Rotate: a pre-login session id (possibly planted) never becomes an authenticated one.
    await this.sessions.create(res, customerId, sessionId(req));
    try {
      await this.carts.mergeAnonymousCart(cartIdFromCookie(req), customerId);
    } catch (e) {
      // Login must not fail because of the cart; the anonymous cart stays usable.
      this.logger.warn(`cart merge failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Identity stitching (docs/07): this browser's past and future sessions belong to the customer.
    await this.identity.link(this.sessions.ensureVisitorId(req, res), customerId);
    return this.me.me(customerId);
  }
}
