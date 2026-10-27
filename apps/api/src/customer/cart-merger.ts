import type { Provider } from '@nestjs/common';
import type { Prisma } from '@forest/db';
import { CartService } from '../commerce/cart.service';

/**
 * Port for merging the anonymous cart (`fr_cart` cookie) into the customer's cart on login.
 * Commerce owns carts; customer auth only calls this port so the two modules stay decoupled.
 */
export interface CartMerger {
  mergeAnonymousCart(anonCartId: string | null, customerId: string): Promise<void>;
  /** Moves a customer's active carts to another customer (account merge), in `tx`. */
  absorbCustomerCarts(
    tx: Prisma.TransactionClient,
    fromCustomerId: string,
    intoCustomerId: string,
  ): Promise<void>;
}

export const CART_MERGER = Symbol('CART_MERGER');

/** Commerce's CartService implements the port (see CommerceModule exports). */
export const cartMergerProvider: Provider = { provide: CART_MERGER, useExisting: CartService };
