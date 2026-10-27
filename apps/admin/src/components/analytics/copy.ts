import {
  type AttentionItemDto,
  type AttributionModel,
  formatAmount,
  formatCompactSoum,
  type FunnelStep,
  type MetricDto,
  relativeDelta,
  soumToTiyin,
} from '@forest/contracts/core';

/** A1/A2/A5/A7 analytics copy and number formats (Uzbek; admin has no RU). */

const NBSP = '\u00A0';

export const INT = (n: number) => formatAmount(soumToTiyin(Math.round(n)));
export const SOUM_FULL = (n: number) => INT(n);
/** `562,1 mln` / `785 000`. */
export const SOUM_SHORT = (n: number) => formatCompactSoum(soumToTiyin(Math.round(n)));

/** `2,8%` (one decimal, comma). */
export function PCT(rate: number | null | undefined, digits = 1): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(digits).replace('.', ',')}%`;
}

/** Fractional orders under linear attribution: `0,33`, whole numbers as is. */
export const ORDERS = (n: number) =>
  Number.isInteger(n) ? INT(n) : n.toFixed(2).replace('.', ',');

export const RATIO_X = (n: number | null) =>
  n === null || !Number.isFinite(n) ? '—' : `${n.toFixed(1).replace('.', ',')}x`;

/** `1:52` (minutes:seconds). */
export function DURATION(sec: number | null): string {
  if (sec === null) return '—';
  const s = Math.round(sec);
  if (s >= 3600)
    return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** KPI delta vs the previous period: relative for counts/money, percentage points for rates. */
export function kpiDelta(
  m: MetricDto,
  kind: 'relative' | 'pp' = 'relative',
): { value: string; direction: 'up' | 'down' | 'flat' } | null {
  if (m.previous === null) return null;
  if (kind === 'pp') {
    const pp = (m.value - m.previous) * 100;
    const direction = Math.abs(pp) < 0.05 ? 'flat' : pp > 0 ? 'up' : 'down';
    return {
      value: `${pp > 0 ? '+' : pp < 0 ? '−' : ''}${Math.abs(pp).toFixed(1).replace('.', ',')}${NBSP}pp`,
      direction,
    };
  }
  const d = relativeDelta(m.value, m.previous);
  if (d === null)
    return m.value > 0
      ? { value: 'yangi', direction: 'up' }
      : { value: "o'zgarishsiz", direction: 'flat' };
  const pct = Math.round(d * 100);
  return {
    value: `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}% oldingi davrga`,
    direction: pct === 0 ? 'flat' : pct > 0 ? 'up' : 'down',
  };
}

export const CHANNEL_LABEL: Record<string, string> = {
  direct: "To'g'ridan",
  organic_search: 'Qidiruv (organik)',
  organic_social: 'Ijtimoiy tarmoq (organik)',
  telegram: 'Telegram',
  referral: 'Boshqa saytlar',
  sms: 'SMS',
  bot: 'Telegram bot',
  email: 'Email',
  phone: "Telefon (qo'ng'iroq)",
  '(pending)': 'Atributsiya hisoblanmoqda',
};

const PAID_LABEL: Record<string, string> = {
  meta: 'Meta reklama',
  instagram: 'Instagram reklama',
  facebook: 'Facebook reklama',
  google: 'Google reklama',
  tiktok: 'TikTok reklama',
  yandex: 'Yandex reklama',
};

export function channelLabel(channel: string): string {
  if (CHANNEL_LABEL[channel]) return CHANNEL_LABEL[channel]!;
  if (channel.startsWith('paid_')) {
    const p = channel.slice(5);
    return PAID_LABEL[p] ?? `${p} reklama`;
  }
  return channel;
}

export const DEVICE_LABEL: Record<string, string> = {
  mobile: 'Mobil',
  desktop: 'Desktop',
  tablet: 'Planshet',
};
export const deviceLabel = (d: string) => DEVICE_LABEL[d] ?? d;

export const FUNNEL_LABEL: Record<FunnelStep, string> = {
  visit: 'Saytga kirdi',
  view_item: "Mahsulot ko'rdi",
  add_to_cart: "Savatga qo'shdi",
  begin_checkout: 'Checkout boshladi',
  purchase: 'Xarid qildi',
};

/** Why sessions dropped between a step and the next one (design A1 "57% shu yerda ketdi…"). */
export const FUNNEL_DROP: Partial<Record<FunnelStep, string>> = {
  view_item: "mahsulot ko'rmadi",
  add_to_cart: "savatga qo'shmadi",
  begin_checkout: 'savatni tashladi',
  purchase: "checkoutda to'xtadi",
};

export const EVENT_LABEL: Record<string, string> = {
  view_item_list: "Ro'yxat ko'rildi",
  view_item: "Mahsulot ko'rildi",
  select_variant: 'Variant tanlandi',
  calculator_used: 'Kalkulyator ishlatildi',
  selector_used: 'Tanlovchi ishlatildi',
  selector_result: 'Tanlovchi natija berdi',
  add_to_cart: "Savatga qo'shildi",
  remove_from_cart: "Savatdan o'chirildi",
  view_cart: "Savat ko'rildi",
  promo_applied: "Promokod qo'llandi",
  promo_rejected: 'Promokod rad etildi',
  begin_checkout: 'Checkout boshlandi',
  add_shipping_info: 'Manzil kiritildi',
  add_payment_info: "To'lov tanlandi",
  search: 'Qidiruv',
  waitlist_join: "Kutish ro'yxatiga yozildi",
  telegram_click: 'Telegram bosildi',
  video_play: "Video ko'rildi",
  lead: 'Raqam qoldirildi',
  purchase: 'Xarid',
};
export const eventLabel = (name: string) => EVENT_LABEL[name] ?? name;

export const MODEL_LABEL: Record<AttributionModel, string> = {
  first_touch: 'Birinchi',
  linear: 'Chiziqli',
  last_non_direct: 'Oxirgi',
};
export const MODEL_HINT: Record<AttributionModel, string> = {
  first_touch: 'birinchi teginish',
  linear: "teng bo'lingan",
  last_non_direct: "oxirgi to'g'ridan bo'lmagan teginish",
};

/**
 * A3 replay of a session (agent 3's heatmap/sessions page reads `?session=`). One place to
 * change if that route moves.
 */
export const replayHref = (sessionId: string) =>
  `/heatmaps?session=${encodeURIComponent(sessionId)}`;

export const PLATFORM_LABEL: Record<string, string> = {
  meta: 'Meta',
  google: 'Google Ads',
  tiktok: 'TikTok',
  yandex: 'Yandex Direct',
};

/** "Diqqat talab qiladi" item text. */
export function attentionText(a: AttentionItemDto): {
  title: string;
  detail: string;
  href: string | null;
} {
  switch (a.kind) {
    case 'sla_risk':
      return {
        title: `Kritik · ${a.overdue + a.atRisk} ta buyurtma SLA xavfida`,
        detail: [
          a.overdue ? `${a.overdue} tasi kechikmoqda` : null,
          a.atRisk ? `${a.atRisk} tasida 1 soatdan kam qoldi` : null,
        ]
          .filter(Boolean)
          .join(', '),
        href: '/orders?tab=sla_risk',
      };
    case 'low_stock':
      return {
        title: `Ogohlantirish · qoldiq kam (${a.count})`,
        detail: a.items
          .map((x) => `${x.name}${x.label ? ` ${x.label}` : ''}: ${x.available} dona`)
          .join(' · '),
        href: '/products',
      };
    case 'anomaly':
      return {
        title: `Ogohlantirish · ${deviceLabel(a.device).toLowerCase()} bounce +${Math.round(a.deltaPp * 100)} pp`,
        detail: `Oxirgi ${a.recentDays} kun ${PCT(a.recentRate, 0)}, oldin ${PCT(a.baselineRate, 0)}`,
        href: '/analytics?tab=pages',
      };
    case 'opportunity':
      return {
        title: `Imkoniyat · ${a.abandonedCarts} ta tashlangan savat`,
        detail: `Oxirgi ${a.days} kun — retarget yoki eslatma uchun tayyor`,
        href: '/customers?segment=abandoned',
      };
  }
}
