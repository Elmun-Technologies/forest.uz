import type {
  IntegrationCardDto,
  IntegrationCategoryKey,
  IntegrationStatusKey,
} from '@forest/contracts/core';

/** A10 copy (Uzbek; design Admin-Integratsiya). */

export const CATEGORY_LABEL: Record<IntegrationCategoryKey, string> = {
  payment: "To'lov",
  delivery: 'Yetkazish',
  erp: 'Ombor va ERP',
  crm: 'CRM',
  feed: 'Marketpleys va feed',
  fiscal: 'Soliq va fiskal',
  messaging: 'Muloqot',
  ads: 'Reklama',
  seo: 'SEO',
  automation: 'Avtomatlashtirish va AI',
};

export const STATUS_LABEL: Record<IntegrationStatusKey, string> = {
  CONNECTED: 'Ulangan',
  DISCONNECTED: 'Ulanmagan',
  ERROR: 'Xato',
  COMING_SOON: 'Tez orada',
};

export const STATUS_TONE: Record<IntegrationStatusKey, 'good' | 'neutral' | 'critical' | 'warn'> = {
  CONNECTED: 'good',
  DISCONNECTED: 'neutral',
  ERROR: 'critical',
  COMING_SOON: 'warn',
};

/** Launch-kit items without credentials explain themselves. */
export function readyNoteText(note: IntegrationCardDto['readyNote']): string | null {
  if (!note) return null;
  if (note.kind === 'manual') return "Qo'lda rejim: trek raqam va holatni operator kiritadi";
  if (note.kind === 'cod')
    return note.enabled ? 'Sozlamalarda yoqilgan' : "Sozlamalarda o'chirilgan";
  return note.missing === 0
    ? 'Barcha faol variantlarda IKPU bor'
    : `${note.missing} ta faol variantda IKPU yo'q`;
}

/** Letter tile for cards (design uses brand marks; we never ship third-party logos here). */
export function markOf(c: { mark: string | null; name: string }): string {
  return (c.mark ?? c.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2)).slice(0, 4).toUpperCase();
}
