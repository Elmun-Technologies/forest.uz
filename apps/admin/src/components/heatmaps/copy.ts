import type {
  HeatmapInsight,
  ReplayFilter,
  ReplayMarkerKind,
  ReplayOutcome,
} from '@forest/contracts/core';

/** A3 "Heatmap va sessiyalar" copy (admin UI is Uzbek-only). */
export const COPY = {
  title: 'Heatmap va sessiyalar',
  subtitle:
    "Telefon, ism, manzil va boshqa kiritilgan ma'lumotlar yozuvda avtomatik yashiriladi (PII masked).",
  page: 'Sahifa',
  device: 'Qurilma',
  period: 'Davr',
  days: (n: number) => `${n} kun`,
  tabs: { click: 'Bosishlar', scroll: 'Scroll chuqurligi', move: 'Harakat' },
  moveNote:
    "Sichqoncha harakati yig'ilmaydi: tracker faqat bosish va scroll'ni yozadi. Harakatni sessiya yozuvlarida ko'ring.",
  legendLow: 'kam',
  legendHigh: "ko'p",
  frameLoading: 'Sahifa yuklanmoqda…',
  frameError: "Sahifani ochib bo'lmadi. Do'kon saytining manzilini tekshiring.",
  frameNote: (w: number) =>
    `Joriy sahifa ${w} px kenglikda, skriptlarsiz va anonim ko'rinishda ko'rsatilgan.`,
  noData: "Bu sahifa va qurilma uchun tanlangan davrda ma'lumot yo'q.",
  kpiSessions: "Ko'rilgan sessiyalar",
  kpiScroll: "O'rtacha scroll",
  kpiRage: 'Rage click',
  kpiDead: 'Dead click',
  elementsTitle: "Eng ko'p bosilgan elementlar",
  elementsEmpty: "Hali bosishlar yo'q.",
  insightsTitle: 'Avtomatik topilgan muammolar',
  insightsEmpty: (min: number) =>
    `Muammo topilmadi. Qoidalar sahifada kamida ${min} ta sessiya bo'lganda ishlaydi.`,
  scrollReached: (depth: number, pct: number | null) =>
    pct === null ? `${depth}%` : `${depth}% gacha · ${pct}% yetdi`,
  aggregatedAt: 'Oxirgi hisob',
  never: 'hali hisoblanmagan',
  refresh: 'Qayta hisoblash',
  refreshQueued: "Navbatga qo'yildi — bir necha daqiqada yangilanadi.",
  sessionsTitle: 'Sessiya yozuvlari',
  sessionsEmpty:
    "Bu filtr bo'yicha yozuvlar yo'q. Yozuv faqat rozilik bergan va tanlovga tushgan tashriflar uchun saqlanadi.",
  all: 'Hammasi',
  more: "Yana ko'rsatish",
  colVisitor: 'Tashrifchi',
  colSource: 'Manba',
  colDevice: 'Qurilma',
  colTime: 'Vaqt',
  colPath: "Yo'l",
  colResult: 'Natija',
  play: "Yozuvni ko'rish",
  playerTitle: 'Pleer',
  playerLoading: 'Yozuv yuklanmoqda…',
  playerMarkers: 'Belgilar: sahifa, bosish, xato, chiqish',
  playerMasked:
    "Kiritish maydonlari va shaxsiy matnlar yozuvda yashirilgan. Ko'rish faoliyat jurnaliga yoziladi.",
  playerTruncated: "Yozuv juda katta: faqat boshlang'ich qismi ko'rsatildi.",
  close: 'Yopish',
  playPause: { play: 'Davom ettirish', pause: "To'xtatish" },
  speed: 'Tezlik',
  settingsTitle: 'Yozuv sozlamalari',
  settingsEnabled: 'Sessiya yozuvi yoqilgan',
  settingsSample: 'Tashriflarning necha foizi yoziladi',
  settingsCheckout: "Checkout'ga yetgan tashriflarning necha foizi yoziladi",
  settingsHint:
    'Yozuv faqat cookie bannerida "Sessiya yozuvi"ga rozilik bergan tashrifchilar uchun. Yozuvlar 30 kundan keyin o\'chiriladi.',
  settingsReadOnly: "Faqat do'kon egasi o'zgartira oladi.",
  save: 'Saqlash',
  saved: 'Saqlandi',
} as const;

export const FILTER_LABEL: Record<ReplayFilter, string> = {
  abandoned: 'Savatni tashlaganlar',
  purchased: 'Xarid qilganlar',
  rage: 'Rage click',
  lead: 'Lead qoldirganlar',
};

export const OUTCOME: Record<
  ReplayOutcome,
  { label: string; tone: 'warn' | 'good' | 'neutral' | 'lead' | 'critical' }
> = {
  abandoned: { label: 'Savat tashlandi', tone: 'warn' },
  purchased: { label: 'Xarid', tone: 'good' },
  exited: { label: 'Chiqib ketdi', tone: 'neutral' },
  lead: { label: 'Lead', tone: 'lead' },
  rage: { label: 'Rage click', tone: 'critical' },
};

export const MARKER: Record<ReplayMarkerKind, { label: string; color: string }> = {
  page: { label: 'Sahifa', color: 'var(--color-chart-1)' },
  click: { label: 'Bosish', color: 'var(--color-chart-2)' },
  error: { label: 'Xato', color: 'var(--color-danger)' },
  exit: { label: 'Chiqish', color: 'var(--color-ink)' },
  rage: { label: 'Rage click', color: 'var(--color-critical)' },
  goal: { label: 'Maqsad', color: 'var(--color-chart-4)' },
};

const GOAL_LABEL: Record<string, string> = {
  add_to_cart: "Savatga qo'shdi",
  begin_checkout: "Checkout'ni boshladi",
  add_payment_info: "To'lov usulini tanladi",
  purchase: 'Xarid',
  lead: 'Lead qoldirdi',
  js_error: 'JS xato',
  form_error: 'Forma xatosi',
  promo_rejected: 'Promokod xato',
  exit: 'Saytdan chiqdi',
};

/** Path for humans: `/` → "Bosh sahifa". */
export function pathLabel(path: string): string {
  return path === '/' ? 'Bosh sahifa' : path;
}

/** Marker chip text: page path, goal/error name in Uzbek, else the raw label. */
export function markerLabel(kind: ReplayMarkerKind, label: string): string {
  if (kind === 'page') return pathLabel(label);
  return GOAL_LABEL[label] ?? label;
}

/** `data-track` label when present, else the last step of the CSS path. */
export function elementLabel(e: { selector: string; label: string | null }): string {
  if (e.label) return e.label;
  return e.selector.split('>').at(-1)?.trim() || e.selector;
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** One sentence per detected problem (thresholds: `HEATMAP_INSIGHT_RULES`). */
export function insightText(i: HeatmapInsight): string {
  switch (i.kind) {
    case 'slow_lcp':
      return `Sahifa sekin yuklanmoqda: ${i.slowPct}% tashrifda asosiy kontent 2,5 s dan kech chiqadi (o'rtacha ${(i.avgMs / 1000).toFixed(1).replace('.', ',')} s).`;
    case 'exit_after_cta':
      return `"${elementLabel(i)}" bosilgandan keyin ${i.exitPct}% foydalanuvchi saytdan chiqib ketadi (${i.clicks} bosish).`;
    case 'dead_clicks':
      return `"${elementLabel(i)}" ga ${i.dead} ta dead click (${i.sharePct}%): bosilganda hech narsa bo'lmaydi.`;
    case 'rage_hotspot':
      return `"${elementLabel(i)}" da ${i.rage} ta rage click: foydalanuvchilar qayta-qayta bosmoqda.`;
    case 'mobile_reach':
      return `Mobilda ${i.notReachedPct}% foydalanuvchi sahifaning ${i.depth}% qismiga yetib bormaydi.`;
  }
}
