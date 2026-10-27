import type { MoyskladFlow, MoyskladMirroredStatus } from '@forest/contracts/core';

/** A13 copy (design Admin-MoySklad). Flow rows: what moves, direction and cadence. */
export const FLOW_ROWS: {
  flow: MoyskladFlow;
  title: string;
  hint: string;
  from: 'MoySklad' | 'Sayt';
  to: 'MoySklad' | 'Sayt';
  cadence: (pollMinutes: number, webhooks: boolean) => string;
}[] = [
  {
    flow: 'products',
    title: 'Mahsulotlar va variantlar',
    hint: 'Nom (faqat yangi mahsulot uchun), SKU, IKPU, mavjudlik',
    from: 'MoySklad',
    to: 'Sayt',
    cadence: (_m, w) => (w ? 'Har soat + webhook' : 'Har soat'),
  },
  {
    flow: 'prices',
    title: 'Narxlar',
    hint: 'Tanlangan narx turi',
    from: 'MoySklad',
    to: 'Sayt',
    cadence: (_m, w) => (w ? 'Webhook · darhol' : 'Har soat'),
  },
  {
    flow: 'stock',
    title: 'Qoldiqlar',
    hint: 'Mavjud − rezerv (tanlangan ombor)',
    from: 'MoySklad',
    to: 'Sayt',
    cadence: (m, w) => (w ? `Webhook + har ${m} daq` : `Har ${m} daq`),
  },
  {
    flow: 'orders',
    title: 'Buyurtmalar',
    hint: 'Mijoz buyurtmasi + rezerv (tasdiqlangandan keyin)',
    from: 'Sayt',
    to: 'MoySklad',
    cadence: () => 'Har daqiqa',
  },
  {
    flow: 'customers',
    title: 'Mijozlar',
    hint: 'Kontragent: ism, telefon',
    from: 'Sayt',
    to: 'MoySklad',
    cadence: () => 'Buyurtma bilan',
  },
  {
    flow: 'statuses',
    title: "To'lov va jo'natish holati",
    hint: 'Buyurtma holati → MoySklad statusi',
    from: 'Sayt',
    to: 'MoySklad',
    cadence: () => 'Har daqiqa',
  },
  {
    flow: 'webhooks',
    title: 'Webhooklar',
    hint: "MoySklad o'zgarishni darhol xabar qiladi",
    from: 'MoySklad',
    to: 'Sayt',
    cadence: () => 'Darhol',
  },
];

export const STATUS_LABEL: Record<MoyskladMirroredStatus, string> = {
  CONFIRMED: 'Tasdiqlandi',
  PACKING: "Yig'ilmoqda",
  READY: 'Tayyor',
  HANDED_TO_COURIER: 'Kuryerda',
  DELIVERED: 'Yetkazildi',
  COMPLETED: 'Yakunlandi',
  CANCELLED: 'Bekor qilindi',
  RETURN_REQUESTED: "Qaytarish so'raldi",
  RETURNED: 'Qaytarildi',
};

export const LOG_KIND_LABEL: Record<string, string> = {
  product: 'Mahsulot',
  price: 'Narx',
  stock: 'Qoldiq',
  order: 'Buyurtma',
  status: 'Holat',
  counterparty: 'Kontragent',
  webhook: 'Webhook',
  sync: 'Sinxron',
  'health.check': 'Tekshiruv',
};

/** docs/02 conflict rules as the sync applies them (CLAUDE.md §6). */
export const RULES: { label: string; value: string }[] = [
  { label: 'Narx/qoldiq ziddiyati', value: 'MoySklad ustun' },
  { label: 'Tavsif, rasm, SEO, nom', value: 'Sayt ustun' },
  { label: 'SKU, IKPU, mavjudlik', value: 'MoySklad ustun' },
  { label: "MoySklad'da yangi pozitsiya", value: 'Qoralama mahsulot — kontent kerak' },
  { label: "MoySklad'da o'chirilgan", value: "Variant o'chiriladi (yo'q qilinmaydi)" },
  { label: "Qoldiq 0 bo'lsa", value: "«Tez orada» + kutish ro'yxati" },
  { label: 'Rezerv', value: "Buyurtmada; tasdiqlangach MoySklad rezerviga o'tadi" },
  { label: "To'plam qoldig'i", value: 'Tarkibiy qismlar minimumi' },
];
