'use client';

import type { ImageDto } from '@forest/contracts';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from '@/i18n/navigation';
import { readConsent, readCookie } from '@/lib/consent';
import {
  FINE_POINTER_QUERY,
  LEAD_TIMER_MS,
  LG_QUERY,
  type LeadPromptMode,
  type LeadPromptVisitor,
  leadPromptAllowed,
  leadPromptDecision,
  leadPromptMode,
  leadTrigger,
} from '@/lib/lead-prompt';
import { LEAD_FLAG } from './use-lead';

const LeadPopupDialog = dynamic(() => import('./lead-popup-dialog'), { ssr: false });
const LeadBar = dynamic(() => import('./lead-bar'), { ssr: false });

const SHOWN_KEY = 'fr_popup_shown';

/** Storage/cookie reads happen only here, when a trigger fires — never at mount (§6 onIdle). */
function visitor(): LeadPromptVisitor | null {
  try {
    return {
      identified: readCookie('fr_ident') !== null,
      leadCaptured: localStorage.getItem(LEAD_FLAG) !== null,
      shownThisSession: sessionStorage.getItem(SHOWN_KEY) !== null,
      consentAnswered: readConsent() !== null,
    };
  } catch {
    return null; // storage disabled: stay quiet
  }
}

/**
 * Lead capture prompt (Popup board), rules in `lib/lead-prompt.ts`. Desktop (`lg`+, fine
 * pointer): the modal popup on exit intent. Below `lg`: after 40 s a slim non-modal bottom bar
 * (above the cart/Telegram bar, never on product pages, cart or checkout); its CTA opens the same
 * form. Once per session; never for identified visitors or ones who already left a phone; waits
 * until the cookie banner is answered. The dialog and bar code load only when needed.
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
  const [shown, setShown] = useState<LeadPromptMode | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // The triggers outlive client navigations inside the shop frame; they read the current path.
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);
  const quiet = !leadPromptAllowed(pathname, 'dialog');

  useEffect(() => {
    if (quiet) return;
    const isLg = window.matchMedia(LG_QUERY).matches;
    const mode = leadPromptMode(isLg);
    let detach = () => {};
    /** true = done with triggers (shown, or never for this visitor). */
    const fire = (): boolean => {
      const v = visitor();
      const decision = v ? leadPromptDecision(path.current, mode, v) : 'never';
      if (decision === 'wait') return false;
      if (decision === 'never') {
        detach();
        return true;
      }
      try {
        sessionStorage.setItem(SHOWN_KEY, '1');
      } catch {
        /* ignore */
      }
      setShown(mode);
      if (mode === 'dialog') setDialogOpen(true);
      detach();
      return true;
    };

    if (leadTrigger(isLg, window.matchMedia(FINE_POINTER_QUERY).matches) === 'exit-intent') {
      const onOut = (e: MouseEvent) => {
        if (!e.relatedTarget && e.clientY <= 0) fire();
      };
      document.addEventListener('mouseout', onOut);
      detach = () => document.removeEventListener('mouseout', onOut);
      return detach;
    }
    const timer = window.setInterval(fire, LEAD_TIMER_MS);
    detach = () => window.clearInterval(timer);
    return detach;
  }, [quiet]);

  if (!shown) return null;
  return (
    <>
      {shown === 'bar' && !dialogOpen && leadPromptAllowed(pathname, 'bar') ? (
        <LeadBar onOpen={() => setDialogOpen(true)} onDismiss={() => setShown(null)} />
      ) : null}
      {dialogOpen ? (
        <LeadPopupDialog
          open
          onOpenChange={(open) => {
            setDialogOpen(open);
            // The bar's job ends once its form was opened; it doesn't come back after closing.
            if (!open) setShown(null);
          }}
          telegramBot={telegramBot}
          before={before}
          after={after}
          fallback={fallback}
        />
      ) : null}
    </>
  );
}
