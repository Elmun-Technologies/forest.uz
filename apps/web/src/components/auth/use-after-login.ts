'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useCart } from '@/components/cart/cart-provider';
import { ClientApiError } from '@/lib/client-api';
import { mergeLocalFavourites } from '@/lib/favourites';

/**
 * Shared post-login step for every login method (SMS code, Telegram): guest favourites move into
 * the account, the cart badge picks up the merged cart, and the visitor returns to `next`
 * (already sanitized by the login page). `router.refresh()` re-runs the middleware, which mirrors
 * the new session as `fr_ident`.
 */
export function useAfterLogin(next: string) {
  const router = useRouter();
  const { refresh } = useCart();
  return useCallback(async () => {
    await mergeLocalFavourites();
    await refresh();
    router.replace(next);
    router.refresh();
  }, [next, refresh, router]);
}

/**
 * Message for a failed auth call: the API's localized text for client errors (incl. rate limits
 * and Telegram codes) and for INTEGRATION_NOT_CONFIGURED (503), else a generic one.
 */
export function useAuthErrorMessage() {
  const tc = useTranslations('common');
  return useCallback(
    (e: unknown): string => {
      if (e instanceof ClientApiError) {
        if (e.code === 'NETWORK') return tc('network');
        if (e.status < 500 || e.code === 'INTEGRATION_NOT_CONFIGURED') return e.message;
      }
      return tc('generic');
    },
    [tc],
  );
}
