/**
 * Integration registry: drives admin A10 (cards, filters, launch kit, credential forms).
 * Adding an integration = add a definition here (+ an adapter when implemented); no UI work.
 * The 46 entries mirror design/source/Admin-Integratsiya.dc.html.
 */
export type IntegrationCategory =
  | 'payment'
  | 'delivery'
  | 'erp'
  | 'crm'
  | 'feed'
  | 'fiscal'
  | 'messaging'
  | 'ads'
  | 'seo'
  | 'automation';

export interface FieldDef {
  key: string;
  label: { uz: string; ru: string };
  type: 'text' | 'secret' | 'select' | 'textarea';
  required: boolean;
  options?: string[];
  placeholder?: string;
}

export interface IntegrationDefinition {
  key: string;
  name: string;
  category: IntegrationCategory;
  description: { uz: string; ru: string };
  /** Letter-mark tile text when no official icon exists (design: "MC", "1C"…). */
  mark?: string;
  icon?: string;
  fields: FieldDef[];
  launchKit: boolean;
  /** available = can be connected; coming_soon = shown as "Tez orada". */
  availability: 'available' | 'coming_soon';
  /** Whether a real adapter exists in this codebase (fake mode is always available). */
  implemented: boolean;
  /** Path of our inbound webhook for this provider, shown in admin (copy to provider cabinet). */
  webhookPath?: string;
  docsUrl?: string;
}

const L = (uz: string, ru: string) => ({ uz, ru });
const secret = (key: string, uz: string, ru: string, required = true): FieldDef => ({
  key,
  label: L(uz, ru),
  type: 'secret',
  required,
});
const text = (key: string, uz: string, ru: string, required = true): FieldDef => ({
  key,
  label: L(uz, ru),
  type: 'text',
  required,
});
const mode: FieldDef = {
  key: 'mode',
  label: L('Rejim', 'Режим'),
  type: 'select',
  required: true,
  options: ['test', 'live'],
};

export const INTEGRATIONS: IntegrationDefinition[] = [
  // ── Payment ──
  {
    key: 'payme',
    name: 'Payme',
    category: 'payment',
    icon: 'payme',
    description: L(
      "Karta orqali onlayn to'lov. Fiskal chek IKPU bilan avtomatik.",
      'Онлайн-оплата картой. Фискальный чек с ИКПУ автоматически.',
    ),
    fields: [
      text('merchantId', 'Merchant ID', 'Merchant ID'),
      secret('key', 'Maxfiy kalit', 'Секретный ключ'),
      secret('testKey', 'Test kalit', 'Тестовый ключ', false),
      mode,
    ],
    launchKit: true,
    availability: 'available',
    implemented: false,
    webhookPath: '/v1/webhooks/payme',
    docsUrl: 'https://developer.help.paycom.uz/',
  },
  {
    key: 'click',
    name: 'Click',
    category: 'payment',
    icon: 'click',
    description: L(
      "Click Up va karta orqali to'lov, holat callback orqali keladi.",
      'Оплата через Click Up и картой, статус приходит по callback.',
    ),
    fields: [
      text('serviceId', 'Service ID', 'Service ID'),
      text('merchantId', 'Merchant ID', 'Merchant ID'),
      text('merchantUserId', 'Merchant user ID', 'Merchant user ID', false),
      secret('secretKey', 'Maxfiy kalit', 'Секретный ключ'),
      mode,
    ],
    launchKit: true,
    availability: 'available',
    implemented: false,
    webhookPath: '/v1/webhooks/click',
    docsUrl: 'https://docs.click.uz/',
  },
  {
    key: 'cod',
    name: 'Naqd / kuryerga',
    category: 'payment',
    mark: "so'm",
    description: L(
      "Olganda to'lov. Kuryer tasdiqlagach buyurtma «to'landi» bo'ladi.",
      'Оплата при получении. Заказ становится «оплачен» после подтверждения курьером.',
    ),
    fields: [],
    launchKit: true,
    availability: 'available',
    implemented: true,
  },
  {
    key: 'uzum_bank',
    name: 'Uzum Bank',
    category: 'payment',
    mark: 'U',
    description: L(
      "Uzum karta egalari uchun qo'shimcha to'lov usuli.",
      'Дополнительный способ оплаты для держателей карт Uzum.',
    ),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'paynet',
    name: 'Paynet',
    category: 'payment',
    mark: 'P',
    description: L(
      "Paynet ilovasi va terminallar orqali to'lov.",
      'Оплата через приложение Paynet и терминалы.',
    ),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'octo',
    name: 'Octo · Visa/Mastercard',
    category: 'payment',
    icon: 'visa',
    description: L(
      'Xorijiy kartalar: diaspora va sayyohlar uchun.',
      'Зарубежные карты: для диаспоры и туристов.',
    ),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'uzum_nasiya',
    name: 'Uzum Nasiya',
    category: 'payment',
    mark: 'UN',
    description: L(
      "Muddatli to'lov: o'rtacha chekni oshiradi.",
      'Рассрочка: увеличивает средний чек.',
    ),
    fields: [],
    launchKit: false,
    availability: 'coming_soon',
    implemented: false,
  },
  {
    key: 'alif_nasiya',
    name: 'Alif Nasiya',
    category: 'payment',
    mark: 'a',
    description: L("Muddatli to'lov, 3–12 oy.", 'Рассрочка на 3–12 месяцев.'),
    fields: [],
    launchKit: false,
    availability: 'coming_soon',
    implemented: false,
  },
  // ── Delivery ──
  {
    key: 'yandex_delivery',
    name: 'Yandex Dostavka',
    category: 'delivery',
    icon: 'yandex-delivery',
    description: L(
      "Toshkent bo'ylab 12 soatda. Narx va kuryer API orqali.",
      'По Ташкенту за 12 часов. Цена и курьер через API.',
    ),
    fields: [
      secret('oauthToken', 'OAuth token', 'OAuth-токен'),
      text('sourceAddress', 'Ombor manzili', 'Адрес склада'),
      text('sourceLat', 'Ombor lat', 'Широта склада', false),
      text('sourceLng', 'Ombor lng', 'Долгота склада', false),
      mode,
    ],
    launchKit: true,
    availability: 'available',
    implemented: false,
    webhookPath: '/v1/webhooks/yandex-delivery',
    docsUrl: 'https://yandex.ru/support/delivery-profile/ru/api/express/',
  },
  {
    key: 'bts',
    name: 'BTS Express',
    category: 'delivery',
    icon: 'bts',
    description: L(
      "Respublika bo'ylab 24 soatda. Trek raqam mijozga botda boradi.",
      'По республике за 24 часа. Трек-номер клиенту приходит в бот.',
    ),
    fields: [
      text('login', 'Login', 'Логин', false),
      secret('password', 'Parol', 'Пароль', false),
      text('apiUrl', 'API manzili', 'Адрес API', false),
    ],
    launchKit: true,
    availability: 'available',
    implemented: false,
    webhookPath: '/v1/webhooks/bts',
  },
  {
    key: 'fargo',
    name: 'Fargo',
    category: 'delivery',
    mark: 'F',
    description: L('Zaxira kuryer xizmati.', 'Резервная курьерская служба.'),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'uzpost',
    name: "O'zbekiston pochtasi",
    category: 'delivery',
    mark: 'UP',
    description: L(
      'Chekka hududlar uchun arzon variant.',
      'Дешёвый вариант для отдалённых районов.',
    ),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'google_maps',
    name: 'Google Maps',
    category: 'delivery',
    icon: 'googlemaps',
    description: L(
      "Checkout'da manzilni avto-to'ldirish va xaritada nuqta.",
      'Автозаполнение адреса и точка на карте в checkout.',
    ),
    fields: [
      text(
        'browserKey',
        'Brauzer kaliti (referrer bilan cheklangan)',
        'Ключ браузера (ограничен referrer)',
      ),
      secret('serverKey', 'Server kaliti', 'Серверный ключ', false),
    ],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  // ── Inventory & ERP ──
  {
    key: 'moysklad',
    name: 'MoySklad',
    category: 'erp',
    mark: 'MC',
    description: L(
      'Ombor, narx, qoldiq va buyurtmalar ikki tomonlama.',
      'Склад, цены, остатки и заказы — двусторонне.',
    ),
    fields: [
      secret('token', 'API token', 'API-токен'),
      text('priceType', 'Narx turi', 'Тип цены'),
      text('store', 'Ombor', 'Склад'),
    ],
    launchKit: true,
    availability: 'available',
    implemented: false,
    webhookPath: '/v1/webhooks/moysklad',
    docsUrl: 'https://dev.moysklad.ru/doc/api/remap/1.2/',
  },
  {
    key: '1c',
    name: '1C',
    category: 'erp',
    mark: '1C',
    description: L(
      "Buxgalteriya kerak bo'lsa MoySklad orqali yoki to'g'ridan.",
      'Если нужна бухгалтерия — через MoySklad или напрямую.',
    ),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'billz',
    name: 'Billz',
    category: 'erp',
    mark: 'B',
    description: L(
      "Oflayn do'kon ochilsa: POS va qoldiq.",
      'Если откроется офлайн-магазин: POS и остатки.',
    ),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  // ── CRM ──
  {
    key: 'amocrm',
    name: 'amoCRM',
    category: 'crm',
    mark: 'amo',
    description: L(
      "Faqat sotuv bo'limi bo'lsa. Asosiy CRM — Forest admin.",
      'Только если будет отдел продаж. Основная CRM — админка Forest.',
    ),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'bitrix24',
    name: 'Bitrix24',
    category: 'crm',
    mark: 'B24',
    description: L("amoCRM o'rniga muqobil.", 'Альтернатива amoCRM.'),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'google_sheets',
    name: 'Google Sheets',
    category: 'crm',
    icon: 'googlesheets',
    description: L(
      'Kunlik buyurtma va lead eksporti hisobot uchun.',
      'Ежедневный экспорт заказов и лидов для отчётов.',
    ),
    fields: [
      secret('serviceAccountJson', 'Service account JSON', 'JSON сервисного аккаунта'),
      text('spreadsheetId', 'Jadval ID', 'ID таблицы'),
    ],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  // ── Marketplaces & feeds ──
  {
    key: 'meta_catalog',
    name: 'Meta katalog',
    category: 'feed',
    icon: 'meta',
    description: L(
      'Instagram Shopping va dinamik retarget uchun mahsulot feedi.',
      'Фид товаров для Instagram Shopping и динамического ретаргета.',
    ),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'google_merchant',
    name: 'Google Merchant',
    category: 'feed',
    icon: 'googleads',
    description: L('Shopping va Performance Max feed.', 'Фид для Shopping и Performance Max.'),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'uzum_market',
    name: 'Uzum Market',
    category: 'feed',
    mark: 'UM',
    description: L(
      'Marketpleysga qoldiq va narx bir manbadan.',
      'Остатки и цены на маркетплейс из одного источника.',
    ),
    fields: [],
    launchKit: false,
    availability: 'coming_soon',
    implemented: false,
  },
  {
    key: 'tiktok_catalog',
    name: 'TikTok katalog',
    category: 'feed',
    icon: 'tiktok',
    description: L('TikTok Shop / katalog reklamasi.', 'TikTok Shop / каталожная реклама.'),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  // ── Tax & fiscal ──
  {
    key: 'fiscal_ofd',
    name: 'Soliq · fiskal chek',
    category: 'fiscal',
    mark: 'OFD',
    description: L(
      "Naqd va kuryer to'lovlari uchun onlayn kassa cheki.",
      'Чек онлайн-кассы для наличных и оплаты курьеру.',
    ),
    fields: [text('provider', 'Provayder', 'Провайдер'), secret('apiKey', 'API kalit', 'API-ключ')],
    launchKit: true,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'ikpu',
    name: 'IKPU (MXIK) katalogi',
    category: 'fiscal',
    mark: 'MXIK',
    description: L(
      "Har SKU'ga soliq kodi, chekka avtomatik qo'shiladi.",
      'Налоговый код на каждый SKU, автоматически попадает в чек.',
    ),
    fields: [],
    launchKit: true,
    availability: 'available',
    implemented: true,
  },
  // ── Messaging ──
  {
    key: 'telegram',
    name: 'Telegram bot',
    category: 'messaging',
    icon: 'telegram',
    description: L(
      'Lead, buyurtma holati, savat, maslahat, sharh.',
      'Лиды, статус заказа, корзина, консультации, отзывы.',
    ),
    fields: [
      secret('botToken', 'Bot token', 'Токен бота'),
      text('botUsername', 'Bot username', 'Username бота'),
      text('adminChatId', 'Admin guruh chat ID', 'Chat ID админ-группы'),
    ],
    launchKit: true,
    availability: 'available',
    implemented: false,
    webhookPath: '/v1/webhooks/telegram',
    docsUrl: 'https://core.telegram.org/bots/api',
  },
  {
    key: 'eskiz',
    name: 'Eskiz SMS',
    category: 'messaging',
    mark: 'SMS',
    description: L(
      "Telegram'i yo'q mijozga kod va holat SMS'i.",
      'Коды и статусы по SMS клиентам без Telegram.',
    ),
    fields: [
      text('email', 'Email', 'Email'),
      secret('password', 'Parol', 'Пароль'),
      text('from', "Jo'natuvchi nomi", 'Имя отправителя'),
    ],
    launchKit: true,
    availability: 'available',
    implemented: false,
    webhookPath: '/v1/webhooks/eskiz',
    docsUrl: 'https://documenter.getpostman.com/view/663428/RzfmES4z',
  },
  {
    key: 'playmobile',
    name: 'Playmobile SMS',
    category: 'messaging',
    mark: 'PM',
    description: L('Zaxira SMS provayder.', 'Резервный SMS-провайдер.'),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    category: 'messaging',
    icon: 'whatsapp',
    description: L('RU-segment va diaspora uchun.', 'Для RU-сегмента и диаспоры.'),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'instagram_direct',
    name: 'Instagram Direct',
    category: 'messaging',
    icon: 'instagram',
    description: L(
      "Direct xabarlari operator inbox'ga tushadi.",
      'Сообщения Direct попадают в инбокс оператора.',
    ),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'chatplace',
    name: 'Chatplace',
    category: 'messaging',
    mark: 'CP',
    description: L(
      'Instagram/Telegram avtomatlashtirish va AI agent.',
      'Автоматизация Instagram/Telegram и AI-агент.',
    ),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  // ── Ads ──
  {
    key: 'meta_capi',
    name: 'Meta Pixel + CAPI',
    category: 'ads',
    icon: 'facebook',
    description: L(
      "Server orqali hodisalar: iOS va adblock'da ham signal.",
      'Серверные события: сигнал даже на iOS и с adblock.',
    ),
    fields: [
      text('pixelId', 'Pixel ID', 'Pixel ID'),
      secret('accessToken', 'Access token', 'Access token'),
      text('testEventCode', 'Test event code', 'Test event code', false),
    ],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'google_ads',
    name: 'Google Ads',
    category: 'ads',
    icon: 'googleads',
    description: L('Konversiya va Enhanced Conversions.', 'Конверсии и Enhanced Conversions.'),
    fields: [
      secret('developerToken', 'Developer token', 'Developer token'),
      text('customerId', 'Customer ID', 'Customer ID'),
      secret('refreshToken', 'OAuth refresh token', 'OAuth refresh token'),
      text('conversionActionId', 'Conversion action ID', 'Conversion action ID'),
    ],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'tiktok_pixel',
    name: 'TikTok Pixel',
    category: 'ads',
    icon: 'tiktok',
    description: L('Events API bilan.', 'С Events API.'),
    fields: [
      text('pixelId', 'Pixel ID', 'Pixel ID'),
      secret('accessToken', 'Access token', 'Access token'),
    ],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'yandex_metrika',
    name: 'Yandex Metrika',
    category: 'ads',
    icon: 'yandexmetrika',
    description: L(
      "Faqat Yandex Direct signali uchun. Analitika — o'zimizniki.",
      'Только для сигналов Яндекс Директа. Аналитика — своя.',
    ),
    fields: [
      text('counterId', 'Hisoblagich ID', 'ID счётчика'),
      secret('oauthToken', 'OAuth token', 'OAuth-токен', false),
    ],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'gtm',
    name: 'Google Tag Manager',
    category: 'ads',
    icon: 'googletagmanager',
    description: L(
      "Ixtiyoriy: marketolog o'z teglarini qo'shishi uchun.",
      'Опционально: чтобы маркетолог добавлял свои теги.',
    ),
    fields: [text('containerId', 'Container ID', 'Container ID')],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'ga4',
    name: 'Google Analytics 4',
    category: 'ads',
    icon: 'googleanalytics',
    description: L(
      'Shart emas. Faqat Google Ads auditoriyasi uchun.',
      'Не обязательно. Только для аудиторий Google Ads.',
    ),
    fields: [text('measurementId', 'Measurement ID', 'Measurement ID')],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  // ── SEO ──
  {
    key: 'gsc',
    name: 'Google Search Console',
    category: 'seo',
    icon: 'googlesearchconsole',
    description: L(
      "Tasdiqlash kodi + sitemap. So'rovlar SEO markazida.",
      'Код подтверждения + sitemap. Запросы — в SEO-центре.',
    ),
    fields: [
      secret('serviceAccountJson', 'Service account JSON', 'JSON сервисного аккаунта', false),
      text('siteUrl', 'Sayt URL', 'URL сайта', false),
    ],
    launchKit: true,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'ywm',
    name: 'Yandex Webmaster',
    category: 'seo',
    icon: 'yandexwebmaster',
    description: L(
      'RU-qidiruv uchun tasdiqlash va indeks.',
      'Подтверждение и индекс для RU-поиска.',
    ),
    fields: [
      secret('oauthToken', 'OAuth token', 'OAuth-токен', false),
      text('userId', 'User ID', 'User ID', false),
      text('hostId', 'Host ID', 'Host ID', false),
    ],
    launchKit: true,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'bing',
    name: 'Bing Webmaster',
    category: 'seo',
    icon: 'bing',
    description: L('Bing va ChatGPT qidiruvi uchun indeks.', 'Индекс для Bing и поиска ChatGPT.'),
    fields: [secret('indexNowKey', 'IndexNow kaliti', 'Ключ IndexNow', false)],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'cloudflare',
    name: 'Cloudflare',
    category: 'seo',
    icon: 'cloudflare',
    description: L(
      'CDN, SSL, rasm tezligi, bot himoyasi.',
      'CDN, SSL, скорость изображений, защита от ботов.',
    ),
    fields: [secret('apiToken', 'API token', 'API-токен'), text('zoneId', 'Zone ID', 'Zone ID')],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  // ── Automation & AI ──
  {
    key: 'n8n',
    name: 'n8n',
    category: 'automation',
    icon: 'n8n',
    description: L(
      "O'z serverimizda avtomatlashtirish oqimlari.",
      'Сценарии автоматизации на нашем сервере.',
    ),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'make',
    name: 'Make',
    category: 'automation',
    icon: 'make',
    description: L('Tayyor ssenariylar, kodsiz.', 'Готовые сценарии без кода.'),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'zapier',
    name: 'Zapier',
    category: 'automation',
    icon: 'zapier',
    description: L('Xorijiy servislar uchun.', 'Для зарубежных сервисов.'),
    fields: [],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'claude',
    name: 'Claude',
    category: 'automation',
    icon: 'claude',
    description: L(
      'Mahsulot tavsifi UZ/RU, operatorga javob qoralamasi.',
      'Описания товаров UZ/RU, черновики ответов оператору.',
    ),
    fields: [secret('apiKey', 'API kalit', 'API-ключ'), text('model', 'Model', 'Модель', false)],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
  {
    key: 'openai',
    name: 'OpenAI',
    category: 'automation',
    icon: 'openai',
    description: L('Muqobil AI provayder.', 'Альтернативный AI-провайдер.'),
    fields: [secret('apiKey', 'API kalit', 'API-ключ'), text('model', 'Model', 'Модель', false)],
    launchKit: false,
    availability: 'available',
    implemented: false,
  },
];

export function getDefinition(key: string): IntegrationDefinition | undefined {
  return INTEGRATIONS.find((d) => d.key === key);
}

export const LAUNCH_KIT_KEYS = INTEGRATIONS.filter((d) => d.launchKit).map((d) => d.key);
