'use client';

import type { ImageDto } from '@forest/contracts';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { usePathname } from '@/i18n/navigation';
import { quietRoutes } from '@/config/site';
import { readConsent, readCookie } from '@/lib/consent';
import { LEAD_FLAG } from './use-lead';

const LeadPopupDialog = dynamic(() => import('./lead-popup-dialog'), { ssr: false });

const SHOWN_KEY = 'fr_popup_shown';
const MOBILE_DELAY_MS = 40_000;

function suppressed(): boolean {
  try {
    return (
      readCookie('fr_ident') !== null ||
      localStorage.getItem(LEAD_FLAG) !== null ||
      sessionStorage.getItem(SHOWN_KEY) !== null
    );
  } catch {
    return true;
  }
}

/**
 * Exit-intent lead popup trigger (Popup board). Desktop: pointer leaves through the top edge.
 * Mobile: after 40 s, or on a fast scroll-up. Once per session; never for identified visitors
 * (`fr_ident`, mirrored by middleware) or ones who already left a phone. Waits until the cookie
 * banner is answered so two overlays never stack. The dialog code loads only when it opens.
 */
export function LeadPopup({
  telegramBot,
  before,
  after,
  fallback,
}: {
  telegramBot: string | null;
  before: ImageDto | null;
  after: ImageDto | null;
  /** Single photo when no before/after pair exists yet. */
  fallback: ImageDto | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const quiet = quietRoutes.some((r) => pathname.startsWith(r));

  useEffect(() => {
    // No cookie/storage reads at mount (the first storage access of a page is a synchronous
    // round-trip to the browser and would land in hydration): `show()` checks before opening and
    // detaches the triggers for suppressed visitors.
    if (quiet) return;
    let detach = () => {};
    const show = () => {
      if (suppressed()) {
        detach();
        return false;
      }
      if (!readConsent()) return false;
      try {
        sessionStorage.setItem(SHOWN_KEY, '1');
      } catch {
        /* ignore */
      }
      setOpen(true);
      return true;
    };

    const desktop = window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches;
    if (desktop) {
      const onOut = (e: MouseEvent) => {
        if (!e.relatedTarget && e.clientY <= 0 && show()) {
          document.removeEventListener('mouseout', onOut);
        }
      };
      document.addEventListener('mouseout', onOut);
      detach = () => document.removeEventListener('mouseout', onOut);
      return detach;
    }

    let lastY = window.scrollY;
    let lastT = performance.now();
    const onScroll = () => {
      const y = window.scrollY;
      const now = performance.now();
      // Fast scroll-up: ≥ 60 % of the viewport upwards within 400 ms (an "I'm leaving" gesture).
      if (lastY - y > window.innerHeight * 0.6 && now - lastT < 400) show();
      if (now - lastT > 400 || y > lastY) {
        lastY = y;
        lastT = now;
      }
    };
    const timer = window.setInterval(() => {
      if (show()) window.clearInterval(timer);
    }, MOBILE_DELAY_MS);
    window.addEventListener('scroll', onScroll, { passive: true });
    detach = () => {
      window.clearInterval(timer);
      window.removeEventListener('scroll', onScroll);
    };
    return detach;
  }, [quiet]);

  if (!open) return null;
  return (
    <LeadPopupDialog
      open={open}
      onOpenChange={setOpen}
      telegramBot={telegramBot}
      before={before}
      after={after}
      fallback={fallback}
    />
  );
}
