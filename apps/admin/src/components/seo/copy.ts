import type { SeoPageKind, SeoRule } from '@forest/contracts/core';

/** A9 SEO markazi copy (admin is Uzbek-only). */
export const COPY = {
  title: 'SEO markazi',
  subtitle:
    "Meta teglar, sitemap, redirect va schema shu yerdan boshqariladi; qidiruv ma'lumotlari API orqali keladi",
  health: 'SEO salomatligi',
  critical: 'kritik',
  warnings: 'ogohlantirish',
  noIssues: 'Muammo topilmadi',
  metaTitle: 'Sahifa meta teglari',
  check: 'Sahifa tekshiruvi',
  serp: "Google'dagi ko'rinishi",
  aiSuggest: 'AI bilan taklif',
  aiHint: "AI taklifi faqat maydonlarni to'ldiradi — tekshirib, keyin saqlaysiz.",
  aiReady: "AI taklifi maydonlarga qo'yildi. Tekshirib, keyin «Saqlash».",
  aiFake: 'Sinov rejimi (fake): matn namunaviy, haqiqiy AI emas.',
  save: 'Saqlash va qayta indekslash',
  saved: "Saqlandi. Sayt sahifasi yangilandi, IndexNow navbatga qo'yildi.",
  reset: 'Shablonga qaytarish',
  templateHint: "Bo'sh qoldirilsa — docs/10 shabloni ishlatiladi.",
  queries: "Qidiruv so'rovlari",
  queriesEmptyConnected:
    "Hali ma'lumot yo'q — sinxronlash har kuni 05:40 da ishlaydi (ma'lumot 2–3 kun kechikadi).",
  queriesNotConnected: 'Ulanmagan. Integratsiyalar sahifasida kalitlarni kiriting.',
  queriesFake: "Fake rejim: tashqi so'rov yuborilmaydi, ma'lumot ko'rsatilmaydi.",
  sync: 'Hozir sinxronlash',
  technical: 'Texnik',
  schema: 'Schema.org shablonlari',
  redirects: '301 redirectlar',
  notFound: '404 xatolar',
  verification: 'Tasdiqlash kodlari',
  verificationHint: "Kodni yoki butun <meta …> tegini qo'ying. Bo'sh = o'chirilgan.",
  robots: 'robots.txt',
  robotsHint: "Bo'sh qoldirilsa — avtomatik (shaxsiy sahifalar yopiq + sitemap qatori).",
  cwv: 'Core Web Vitals · mobil',
  cwvAll: 'Core Web Vitals · barcha qurilmalar',
  cwvEmpty: "Hali o'lchov yo'q — tracker web_vitals hodisalarini yig'gach paydo bo'ladi.",
  zero: 'Natijasiz qidiruvlar (30 kun)',
  zeroEmpty: "Natijasiz qidiruv yo'q.",
  issues: 'Muammolar',
} as const;

export const KIND_LABEL: Record<SeoPageKind, string> = {
  home: 'Bosh sahifa',
  catalog: 'Katalog',
  category: 'Kategoriya',
  product: 'Mahsulot',
  legal: 'Huquqiy',
  article: 'Maqola',
};

export const RULE_LABEL: Record<SeoRule, { title: string; hint: string }> = {
  title_missing: { title: "Title yo'q", hint: 'Sahifa sarlavhasi kerak' },
  description_missing: { title: "Description yo'q", hint: 'Qisqa tavsif kerak' },
  noindex_in_sitemap: {
    title: 'Noindex muhim sahifada',
    hint: 'Sahifa qidiruvdan yashirilgan — ataylabmi?',
  },
  canonical_foreign: { title: 'Canonical boshqa sahifaga', hint: 'Sahifa indeksdan chiqadi' },
  broken_link: { title: 'Buzilgan ichki havola', hint: '404 yoki o‘lik redirect manzili' },
  cwv_poor: { title: 'CWV yomon', hint: 'p75 chegaradan yomon' },
  title_duplicate: { title: 'Title takrorlangan', hint: 'Boshqa sahifada ham xuddi shunday' },
  description_duplicate: {
    title: 'Description takrorlangan',
    hint: 'Boshqa sahifada ham xuddi shunday',
  },
  title_length: { title: 'Title uzunligi', hint: '30–60 belgi oralig‘ida bo‘lsin' },
  description_length: { title: 'Description uzunligi', hint: '70–160 belgi' },
  alt_missing: { title: "Rasmda alt yo'q", hint: 'Shu tildagi alt matn kerak' },
  cwv_needs_improvement: { title: 'CWV yaxshilash kerak', hint: 'p75 o‘rtacha zonada' },
};

export const SCHEMA_LABEL = {
  product: 'Product + Offer + AggregateRating',
  organization: 'Organization + LocalBusiness',
  breadcrumb: 'BreadcrumbList',
  faq: 'FAQPage',
  howTo: 'HowTo',
  video: 'VideoObject',
} as const;
