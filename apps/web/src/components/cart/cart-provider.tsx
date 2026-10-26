'use client';

import type { CartDto } from '@forest/contracts';
import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import { useToast } from '@/components/ui/toast';

export interface CartLineInput {
  variantId: string;
  qty: number;
  /** Unit price for the optimistic total (the server total replaces it on success). */
  priceSoum?: number;
}

export interface CartContextValue {
  /** `unavailable` = the cart API failed/doesn't exist; UI shows 0 and keeps working. */
  status: 'loading' | 'ready' | 'unavailable';
  count: number;
  totalSoum: number;
  cart: CartDto | null;
  /** Optimistically adds lines (sequentially), rolls back + toasts on failure. */
  addItems: (lines: CartLineInput[]) => Promise<boolean>;
  /** Replace local state with a CartDto returned by any other cart call (qty change, promo…). */
  setCart: (cart: CartDto) => void;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

/**
 * Single source of truth for the header count and mobile cart bars. Reads `GET /api/cart` once
 * on mount; every mutation returns the full CartDto, which replaces the optimistic state.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('cart');
  const toast = useToast();
  const [cart, setCartState] = useState<CartDto | null>(null);
  const [status, setStatus] = useState<CartContextValue['status']>('loading');
  const [optimistic, setOptimistic] = useState({ count: 0, total: 0 });

  const setCart = useCallback((next: CartDto) => {
    setCartState(next);
    setStatus('ready');
    setOptimistic({ count: 0, total: 0 });
  }, []);

  const refresh = useCallback(async () => {
    try {
      setCart(await clientApi.cart.get());
    } catch {
      setStatus('unavailable');
    }
  }, [setCart]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addItems = useCallback(
    async (lines: CartLineInput[]) => {
      const qty = lines.reduce((a, l) => a + l.qty, 0);
      const sum = lines.reduce((a, l) => a + (l.priceSoum ?? 0) * l.qty, 0);
      setOptimistic((o) => ({ count: o.count + qty, total: o.total + sum }));
      try {
        let last: CartDto | null = null;
        for (const l of lines)
          last = await clientApi.cart.addItem({ variantId: l.variantId, qty: l.qty });
        if (last) setCart(last);
        toast(t('added'), 'good');
        return true;
      } catch (e) {
        setOptimistic((o) => ({ count: o.count - qty, total: o.total - sum }));
        const message =
          e instanceof ClientApiError && e.status !== 404 && e.code !== 'NETWORK'
            ? e.message
            : t('addFailed');
        toast(message, 'critical');
        return false;
      }
    },
    [setCart, t, toast],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      status,
      cart,
      count: (cart?.totals.itemsCount ?? 0) + optimistic.count,
      totalSoum: (cart?.totals.totalSoum ?? 0) + optimistic.total,
      addItems,
      setCart,
      refresh,
    }),
    [status, cart, optimistic, addItems, setCart, refresh],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
