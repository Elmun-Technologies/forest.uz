import type { Locale } from '@forest/contracts';

/**
 * `{link}` of abandoned-cart reminders: the bot's `CartLinkService` signs a restore link
 * `${APP_URL}/c/<token>` that brings the cart back on any device.
 */
export interface CartLinks {
  restoreUrl(input: {
    cartId: string;
    promo?: 'SAVAT5';
    campaign: string;
    locale?: Locale;
  }): string | Promise<string>;
}

export const CART_LINKS = Symbol('CART_LINKS');
