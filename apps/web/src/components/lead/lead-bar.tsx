'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Phones (below `lg`): slim, non-modal promo bar instead of the full-screen popup (CLAUDE.md §6,
 * 2026-11-12). Sits above the mobile cart/Telegram bar (that bar is 5rem + the safe-area inset
 * tall) and leaves the page usable; the CTA opens the lead form, × hides it for the session.
 */
export default function LeadBar({
  onOpen,
  onDismiss,
}: {
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('popup');
  const tc = useTranslations('common');
  return (
    <aside
      aria-label={t('barLabel')}
      data-testid="lead-bar"
      className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-1 rounded-pill bg-forest py-1 pr-1 pl-4 text-white shadow-float lg:hidden"
    >
      <p className="min-w-0 flex-1 text-[13px] leading-tight font-semibold">{t('barText')}</p>
      <button
        type="button"
        onClick={onOpen}
        data-track="lead_bar_open"
        className="h-11 shrink-0 rounded-pill bg-white px-4 text-[13px] font-semibold text-ink"
      >
        {t('barCta')}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={tc('close')}
        className="grid size-11 shrink-0 place-items-center rounded-pill"
      >
        <X size={18} strokeWidth={2} aria-hidden />
      </button>
    </aside>
  );
}
