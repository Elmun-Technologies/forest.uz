import type {
  BotConversationStatus,
  BotConversationTopic,
  BotScenario,
} from '@forest/contracts/core';

/** A12 Telegram bot admin copy (Uzbek; docs/08, design Admin-Bot). */
export const COPY = {
  title: 'Telegram bot va xabarlar',
  subtitle: 'faqat xizmat: lead, holat, savat, maslahat, sharh',
  notConnected: "Bot ulanmagan. Integratsiyalar bo'limida bot tokenini kiriting.",
  toIntegrations: 'Integratsiyalar ↗',
  tabs: { overview: 'Umumiy', inbox: 'Operator inbox', messages: 'Xabarlar' },
  kpiSubscribers: 'Obunachilar',
  kpiPhones: 'Telefon olindi',
  kpiOrders: 'Botdan buyurtma',
  kpiRevenue: 'Bot daromadi',
  kpiUnsub: 'Bekor qilganlar',
  per30: '/ 30 kun',
  ofSubscribers: 'obunachidan',
  revenueHint: "so'm · 30 kun",
  unsubHint: "me'yor < 5%",
  none: '—',
  scenarios: 'Ssenariylar',
  days30: '30 kun',
  colScenario: 'Ssenariy · trigger',
  colSent: 'Yuborildi',
  colResult: 'Natija',
  resultNote:
    "Natija = buyurtma, lead yoki sharh (30 kun). Bot katalog va savdo qilmaydi — savdo saytda tugaydi. Telegram o'qilganlik ma'lumotini bermaydi.",
  keywords: "Shikoyat so'zlari",
  keywordsHint:
    "Mijoz xabarida shu so'z (yoki uning boshlanishi) bo'lsa, suhbat «Shikoyat» bo'ladi va admin guruhiga signal ketadi. Vergul bilan ajrating.",
  save: 'Saqlash',
  saved: 'Saqlandi',
  settings: 'Sozlamalar',
  hours: 'Ish vaqti',
  offHours: 'Ish vaqtidan tashqari',
  offHoursValue: 'Avto-javob + ertalab',
  operators: 'Operatorlar',
  noOperators: 'Belgilanmagan',
  languages: 'Tillar',
  cap: 'Kuniga max xabar',
  perCustomer: 'ta / mijoz',
  token: 'Bot tokeni',
  adminGroup: 'Admin guruhi',
  adminGroupOn: 'Ulangan',
  adminGroupOff: 'Chat ID kiritilmagan',
  alertNote: "Shikoyat (≤3★) va «operator» so'rovi admin guruhiga darhol signal beradi.",
  editSettings: "Xabarlar va sozlamalarni o'zgartirish ↗",
  // Inbox
  inboxTitle: 'Operator inbox',
  allStatuses: 'Hammasi',
  empty: "Bu bo'limda suhbat yo'q.",
  pick: 'Chap tomondan suhbatni tanlang.',
  reply: 'Javob',
  replyPlaceholder: 'Rang va miqdorni yozing…',
  send: 'Yuborish',
  sending: 'Yuborilmoqda…',
  product: "Mahsulot kartasi «Savatga qo'shish ↗»",
  productSearch: 'Mahsulot yoki SKU qidirish',
  removeProduct: 'Olib tashlash',
  close: 'Yopish',
  reopen: 'Qayta ochish',
  assignee: "Mas'ul",
  unassigned: 'Tayinlanmagan',
  customer: 'Mijoz kartasi ↗',
  cannotReply: 'Bot bu chatga yoza olmaydi (bloklangan yoki ulanmagan).',
  photo: 'Rasm',
  customerSide: 'Mijoz',
  more: "Ko'proq",
} as const;

export const SCENARIO_LABEL: Record<BotScenario, { title: string; trigger: string }> = {
  lead: { title: '1. Lead: telefon va chegirma', trigger: 'Saytdan /start yoki popup' },
  orderStatus: { title: '2. Buyurtma holati', trigger: "Holat o'zgarganda" },
  abandonedCart: { title: '3. Tashlangan savat', trigger: 'Savat, 2 soat buyurtmasiz' },
  advice: { title: '4. Rang maslahati', trigger: 'Foto yoki savol yuborilganda' },
  review: { title: '5. Sharh va foto', trigger: 'Yetkazilgandan 3 kun keyin' },
};

export const RESULT_UNIT = { leads: 'lead', orders: 'buyurtma', reviews: 'sharh' } as const;

export const STATUS_LABEL: Record<BotConversationStatus, string> = {
  NEW: 'Yangi',
  OPEN: 'Ochiq',
  ANSWERED: 'Javob berildi',
  COMPLAINT: 'Shikoyat',
  CLOSED: 'Yopildi',
};

export const STATUS_TONE: Record<
  BotConversationStatus,
  'dark' | 'neutral' | 'good' | 'critical' | 'light'
> = {
  NEW: 'dark',
  OPEN: 'neutral',
  ANSWERED: 'good',
  COMPLAINT: 'critical',
  CLOSED: 'neutral',
};

export const TOPIC_LABEL: Record<BotConversationTopic, string> = {
  advice: 'Rang maslahati',
  cart: 'Savat',
  status: 'Holat',
  review: 'Sharh',
  other: 'Savol',
};

export const DAY_SHORT = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];
