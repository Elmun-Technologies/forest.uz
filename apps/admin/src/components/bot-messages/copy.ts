import type { MessageKind, MessageScenario, TemplateProblem } from '@forest/contracts/core';

/** A12 "Xabarlar" copy (admin UI is Uzbek-only, CLAUDE.md §6). */
export const COPY = {
  title: 'Xabarlar va avtomatlar',
  subtitle:
    'Shablonlar (UZ/RU), avtomatik xabarlar, cheklovlar. Reklama xabarlari faqat roziligi bor mijozga, kuniga cheklangan miqdorda va tungi soatlardan tashqarida yuboriladi.',
  templates: 'Shablonlar',
  newTemplate: 'Yangi auditoriya shabloni',
  emptyTemplates: "Shablonlar yo'q. Ma'lumotlar bazasi migratsiyasini tekshiring.",
  body: 'Xabar matni',
  variables: "O'zgaruvchilar",
  variablesHint: "Bosing — matnga qo'shiladi. Faqat shu shablon uchun ruxsat etilganlari.",
  preview: "Ko'rinishi",
  previewNote: 'Namuna qiymatlar bilan',
  smsPreview: "SMS ko'rinishi",
  buttons: 'Tugma',
  buttonText: 'Tugma matni',
  buttonUrl: 'Havola',
  buttonUrlHint: '{link} — xabarning o‘z havolasi, yoki https://…',
  addButton: "Tugma qo'shish",
  removeButton: 'Tugmani olib tashlash',
  delay: 'Kechikish, daqiqa',
  delayHint: 'Trigger (savat, yetkazish) dan keyin.',
  smsFallback: "Telegram yo'q bo'lsa SMS",
  smsApproved: 'Eskiz tasdiqlagan',
  smsApprovedHint:
    "SMS matni Eskiz kabinetida tasdiqlangan bo'lishi shart. Matn o'zgarsa belgi olinadi — qayta tasdiqlatib, keyin belgilang. Tasdiqlanmagan matn SMS orqali yuborilmaydi.",
  active: 'Faol',
  marketingNote:
    "Faqat roziligi bor mijozga yuboriladi. Har bir xabarda «Eslatmani o'chirish» tugmasi (SMS'da havola) avtomatik qo'shiladi.",
  save: 'Saqlash',
  delete: "Shablonni o'chirish",
  deleteConfirm:
    "Shablon o'chirilsinmi? Auditoriyada ishlatilayotgan shablonni o'chirib bo'lmaydi.",
  saved: 'Saqlandi',
  test: "O'zimga test",
  testHint: 'Saqlangan matn profilingizdagi telefonga SMS bo‘lib keladi.',
  testDirty: 'Avval saqlang',
  testSent: (to: string) => `Test yuborildi: ${to}`,
  key: 'Kalit',
  keyHint: 'custom_ bilan boshlanadi: lotin kichik harflari, raqam, _',
  stats: '30 kun',
  sent: 'yuborildi',
  skipped: "o'tkazildi",
  failed: 'xato',
  settings: 'Sozlamalar',
  settingsSaved: 'Sozlamalar saqlandi',
  cap: 'Kuniga max reklama xabari (mijozga)',
  capHint: 'Telegram + SMS birga. Xizmat xabarlari (buyurtma holati) hisoblanmaydi.',
  quiet: 'Tungi soatlar (yuborilmaydi)',
  quietHint: 'Bu oraliqdagi xabarlar ertalab yuboriladi, bekor qilinmaydi.',
  hours: 'Operator ish vaqti',
  days: 'Ish kunlari',
  operators: 'Operatorlar',
  operatorsEmpty: "Inbox huquqi bor xodim yo'q.",
  languages: 'Tillar',
  languagesHint: "Mijoz tili (sayt) bo'yicha, bo'lmasa Telegram tili.",
  scenarios: 'Avtomatik xabarlar',
  abandonedCart: 'Tashlangan savat',
  reviewRequest: "Sharh so'rovi",
  waitlist: 'Omborga qaytdi (kutish ro‘yxati)',
  delays: (cart: number, review: number) =>
    `Kechikishlar shablonlarda: savat ${cart} daq · sharh ${review} kun.`,
  bot: 'Bot',
  botToken: 'Bot tokeni',
  botNotConnected: 'Ulanmagan',
  botManage: 'Integratsiyalarda',
  offHours: 'Ish vaqtidan tashqari javob',
  offHoursEdit: 'Shablonni tahrirlash',
} as const;

export const KIND_LABEL: Record<MessageKind, string> = {
  service: 'Xizmat',
  requested: "So'ralgan",
  marketing: 'Reklama',
};

export const KIND_TONE = { service: 'neutral', requested: 'info', marketing: 'warn' } as const;

export const SCENARIO_LABEL: Record<MessageScenario, string> = {
  auth: 'Kirish',
  lead: 'Lead',
  order: 'Buyurtma holati',
  cart: 'Tashlangan savat',
  advice: 'Rang maslahati',
  review: 'Sharh',
  waitlist: 'Kutish ro‘yxati',
  audience: 'Auditoriyalar',
};

export const DAY_LABELS = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];

export function problemText(p: TemplateProblem): string {
  const where = p.field.startsWith('body.')
    ? `Matn ${p.field.slice(5).toUpperCase()}`
    : p.field.startsWith('buttons.')
      ? 'Tugma'
      : p.field;
  switch (p.code) {
    case 'empty':
      return `${where}: bo'sh`;
    case 'too_long':
      return `${where}: juda uzun`;
    case 'unknown_variable':
      return `${where}: {${p.variable}} bu shablonda ishlatilmaydi`;
    case 'missing_variable':
      return `${where}: {${p.variable}} bo'lishi shart`;
    case 'button_url':
      return `${where}: havola {link} yoki https://… bo'lsin`;
  }
}
