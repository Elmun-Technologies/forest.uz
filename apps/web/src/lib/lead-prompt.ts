/**
 * When and how the lead capture prompt (promo for a phone number) may appear (CLAUDE.md §6,
 * 2026-11-12). Pure so the rules are unit-tested; `components/lead/lead-popup.tsx` wires them to
 * the browser.
 *
 * - `dialog` (viewport ≥ `lg`): the existing modal popup.
 * - `bar` (phones/tablets below `lg`): a slim non-modal bottom bar whose CTA opens the form. Not an
 *   interstitial, so it never covers the page (Google's mobile intrusive-interstitial rule).
 *
 * Triggers: exit intent (pointer leaves through the top edge) only with a fine pointer at `lg`+;
 * otherwise only the time trigger. The old "fast scroll-up" trigger is gone: an ordinary flick back
 * to the header fired it.
 */
import { ownBottomBarRoutes, quietRoutes } from '@/config/site';

export type LeadPromptMode = 'dialog' | 'bar';
export type LeadTrigger = 'exit-intent' | 'timer';

/** Time on the site (ms) before the time trigger fires; it then retries at the same interval. */
export const LEAD_TIMER_MS = 40_000;

/** Media queries (match Tailwind's `lg` = 64rem = 1024 px). */
export const LG_QUERY = '(min-width: 1024px)';
export const FINE_POINTER_QUERY = '(pointer: fine)';

export function leadPromptMode(isLg: boolean): LeadPromptMode {
  return isLg ? 'dialog' : 'bar';
}

export function leadTrigger(isLg: boolean, finePointer: boolean): LeadTrigger {
  return isLg && finePointer ? 'exit-intent' : 'timer';
}

/**
 * Whether the prompt may show on a locale-less storefront path. Never in buying/account flows
 * (`quietRoutes`); the phone bar also stays off product pages, whose sticky buy bar owns the
 * bottom edge (`ownBottomBarRoutes`).
 */
export function leadPromptAllowed(pathname: string, mode: LeadPromptMode): boolean {
  if (quietRoutes.some((r) => pathname.startsWith(r))) return false;
  if (mode === 'bar' && ownBottomBarRoutes.some((r) => pathname.startsWith(r))) return false;
  return true;
}

export interface LeadPromptVisitor {
  /** Logged-in visitor (`fr_ident`, mirrored by middleware). */
  identified: boolean;
  /** Already left a phone in this browser (`fr_lead` in localStorage). */
  leadCaptured: boolean;
  /** The prompt already appeared in this tab session (`fr_popup_shown` in sessionStorage). */
  shownThisSession: boolean;
  /** The cookie banner was answered (two overlays never stack). */
  consentAnswered: boolean;
}

/**
 * What a firing trigger does: `show`; `wait` (not now — the next trigger tries again); `never`
 * (detach the triggers for this page view). Once per session, never for identified visitors or
 * ones who already left a phone (unchanged by the 2026-11-12 mobile decision).
 */
export function leadPromptDecision(
  pathname: string,
  mode: LeadPromptMode,
  v: LeadPromptVisitor,
): 'show' | 'wait' | 'never' {
  if (v.identified || v.leadCaptured || v.shownThisSession) return 'never';
  if (!v.consentAnswered || !leadPromptAllowed(pathname, mode)) return 'wait';
  return 'show';
}
