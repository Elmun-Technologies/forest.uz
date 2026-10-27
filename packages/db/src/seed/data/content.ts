import type { ContentBlock } from '@forest/contracts';

type L = { uz: string; ru: string };
type LB = { uz: ContentBlock[]; ru: ContentBlock[] };

/**
 * Legal drafts from design/source/Huquqiy.dc.html. DRAFT — lawyer review mandatory before launch.
 * `{store.legal.*}` and `{returns.*}` are filled from settings; blocks with missing data are hidden.
 */
export const legalPages: { slug: string; title: L; subtitle: L; body: LB }[] = [
  {
    slug: 'oferta',
    title: { uz: 'Ommaviy oferta', ru: 'Публичная оферта' },
    subtitle: { uz: 'Sotib olish shartlari', ru: 'Условия покупки' },
    body: {
      uz: [
        {
          type: 'p',
          text: "Ushbu hujjat {store.legal.entityName} (STIR {store.legal.stir}, manzil: {store.legal.address}, keyingi o'rinlarda — «Sotuvchi») tomonidan {store.domain} sayti orqali mahsulot sotish shartlarini belgilaydi.",
        },
        {
          type: 'p',
          text: "Saytda buyurtmani tasdiqlash ushbu oferta shartlarini to'liq qabul qilish hisoblanadi.",
        },
        { type: 'h2', text: '1. Buyurtma va narx' },
        {
          type: 'p',
          text: "Narxlar so'mda ko'rsatiladi va buyurtma tasdiqlangan paytdagi narx qat'iy bo'ladi. Mahsulot omborda tugagan bo'lsa, Sotuvchi 1 soat ichida mijoz bilan bog'lanib, almashtirish yoki pulni qaytarishni taklif qiladi.",
        },
        { type: 'h2', text: "2. To'lov" },
        {
          type: 'p',
          text: "To'lov Payme, Click yoki mahsulotni olganda naqd/karta orqali amalga oshiriladi. Har bir to'lov uchun fiskal chek beriladi. Karta ma'lumotlari Sotuvchi serverlarida saqlanmaydi — ular to'lov tizimi tomonida qayta ishlanadi.",
        },
        { type: 'h2', text: '3. Yetkazish' },
        {
          type: 'p',
          text: "Toshkent shahri bo'ylab — Yandex Dostavka orqali 12 soat ichida. O'zbekiston bo'ylab — BTS Express orqali 24 soat ichida. Muddat to'lov tasdiqlangan (yoki naqd buyurtma qabul qilingan) paytdan hisoblanadi. Narx va bepul yetkazish chegarasi «Yetkazish va to'lov» sahifasida.",
        },
        { type: 'h2', text: '4. Qaytarish' },
        {
          type: 'p',
          text: "Qaytarish va almashtirish tartibi «Qaytarish» bo'limida belgilangan va O'zbekiston Respublikasining iste'molchilar huquqlarini himoya qilish to'g'risidagi qonunchiligiga muvofiq.",
        },
        { type: 'h2', text: '5. Javobgarlik' },
        {
          type: 'p',
          text: "Sotuvchi mahsulot yo'riqnomaga muvofiq qo'llanganda uning sifati uchun javob beradi. Yo'riqnomaga zid foydalanish (sirtni tayyorlamaslik, quritish vaqtini buzish) natijasi kafolatga kirmaydi.",
        },
        { type: 'h2', text: '6. Rekvizitlar' },
        {
          type: 'dl',
          items: [
            { term: 'Nomi', desc: '{store.legal.entityName}' },
            { term: 'STIR', desc: '{store.legal.stir}' },
            {
              term: 'Hisob raqami / bank',
              desc: '{store.legal.account} · {store.legal.bank}, MFO {store.legal.mfo}',
            },
            { term: 'Manzil', desc: '{store.legal.address}' },
            { term: 'Aloqa', desc: '{store.phoneFormatted} · {store.email}' },
          ],
        },
      ],
      ru: [
        {
          type: 'p',
          text: 'Настоящий документ определяет условия продажи товаров компанией {store.legal.entityName} (ИНН {store.legal.stir}, адрес: {store.legal.address}, далее — «Продавец») через сайт {store.domain}.',
        },
        {
          type: 'p',
          text: 'Подтверждение заказа на сайте означает полное принятие условий настоящей оферты.',
        },
        { type: 'h2', text: '1. Заказ и цена' },
        {
          type: 'p',
          text: 'Цены указаны в сумах; цена на момент подтверждения заказа является окончательной. Если товара не оказалось на складе, Продавец в течение 1 часа свяжется с покупателем и предложит замену или возврат денег.',
        },
        { type: 'h2', text: '2. Оплата' },
        {
          type: 'p',
          text: 'Оплата производится через Payme, Click или наличными/картой при получении. На каждый платёж выдаётся фискальный чек. Данные карты не хранятся на серверах Продавца — их обрабатывает платёжная система.',
        },
        { type: 'h2', text: '3. Доставка' },
        {
          type: 'p',
          text: 'По Ташкенту — Яндекс Доставкой в течение 12 часов. По Узбекистану — BTS Express в течение 24 часов. Срок отсчитывается с момента подтверждения оплаты (или принятия заказа с оплатой при получении). Стоимость и порог бесплатной доставки — на странице «Доставка и оплата».',
        },
        { type: 'h2', text: '4. Возврат' },
        {
          type: 'p',
          text: 'Порядок возврата и обмена установлен в разделе «Возврат» и соответствует законодательству Республики Узбекистан о защите прав потребителей.',
        },
        { type: 'h2', text: '5. Ответственность' },
        {
          type: 'p',
          text: 'Продавец отвечает за качество товара при его применении согласно инструкции. Последствия использования вопреки инструкции (без подготовки поверхности, с нарушением времени высыхания) гарантией не покрываются.',
        },
        { type: 'h2', text: '6. Реквизиты' },
        {
          type: 'dl',
          items: [
            { term: 'Наименование', desc: '{store.legal.entityName}' },
            { term: 'ИНН', desc: '{store.legal.stir}' },
            {
              term: 'Расчётный счёт / банк',
              desc: '{store.legal.account} · {store.legal.bank}, МФО {store.legal.mfo}',
            },
            { term: 'Адрес', desc: '{store.legal.address}' },
            { term: 'Контакты', desc: '{store.phoneFormatted} · {store.email}' },
          ],
        },
      ],
    },
  },
  {
    slug: 'maxfiylik',
    title: { uz: 'Maxfiylik siyosati', ru: 'Политика конфиденциальности' },
    subtitle: { uz: "Shaxsiy ma'lumotlar va cookie", ru: 'Персональные данные и cookie' },
    body: {
      uz: [
        {
          type: 'p',
          text: "Biz faqat buyurtmani bajarish va xizmatni yaxshilash uchun kerakli ma'lumotlarni yig'amiz.",
        },
        {
          type: 'dl',
          items: [
            {
              term: "Nimani yig'amiz",
              desc: "Ism, telefon, yetkazish manzili, buyurtmalar tarixi, saytdagi harakatlar (sahifalar, bosishlar), qurilma turi. Telegram orqali kirsangiz — Telegram ID, ism va username (Telegram bizga yuboradigan ma'lumotlar).",
            },
            {
              term: "Nimani yig'maymiz",
              desc: 'Karta raqami va parollar. Sessiya yozuvida kiritish maydonlari avtomatik yashiriladi.',
            },
            {
              term: 'Qayerda saqlanadi',
              desc: "O'zbekiston Respublikasi hududidagi serverlarda, shaxsga doir ma'lumotlar to'g'risidagi qonunchilik talabiga muvofiq.",
            },
            {
              term: 'Kimga beriladi',
              desc: "Faqat buyurtma uchun kerak bo'lganlarga: to'lov tizimi, kuryer xizmati, SMS provayder. Reklama tizimlariga faqat shifrlangan (hash) ko'rinishda.",
            },
          ],
        },
        { type: 'h2', text: 'Sizning huquqlaringiz' },
        {
          type: 'p',
          text: "Ma'lumotlaringizni ko'rish, tuzatish yoki o'chirishni so'rashingiz mumkin: shaxsiy kabinetda yoki {store.email} orqali. So'rov {store.deletionSlaDays} kun ichida bajariladi. Telegram va SMS xabarlardan istalgan vaqtda voz kechish mumkin.",
        },
        { type: 'h2', text: 'Cookie' },
        {
          type: 'p',
          text: "Zarur cookie'lar savat va kirish uchun ishlaydi. Analitika va reklama cookie'lari faqat roziligingiz bilan yoqiladi.",
        },
      ],
      ru: [
        {
          type: 'p',
          text: 'Мы собираем только те данные, которые нужны для выполнения заказа и улучшения сервиса.',
        },
        {
          type: 'dl',
          items: [
            {
              term: 'Что собираем',
              desc: 'Имя, телефон, адрес доставки, историю заказов, действия на сайте (страницы, клики), тип устройства. При входе через Telegram — Telegram ID, имя и username (данные, которые передаёт Telegram).',
            },
            {
              term: 'Что не собираем',
              desc: 'Номера карт и пароли. В записи сессий поля ввода скрываются автоматически.',
            },
            {
              term: 'Где хранятся',
              desc: 'На серверах на территории Республики Узбекистан, в соответствии с законодательством о персональных данных.',
            },
            {
              term: 'Кому передаются',
              desc: 'Только тем, кто нужен для выполнения заказа: платёжной системе, службе доставки, SMS-провайдеру. Рекламным системам — только в зашифрованном (хешированном) виде.',
            },
          ],
        },
        { type: 'h2', text: 'Ваши права' },
        {
          type: 'p',
          text: 'Вы можете запросить просмотр, исправление или удаление своих данных в личном кабинете или по адресу {store.email}. Запрос выполняется в течение {store.deletionSlaDays} дней. От сообщений в Telegram и SMS можно отказаться в любой момент.',
        },
        { type: 'h2', text: 'Cookie' },
        {
          type: 'p',
          text: 'Необходимые cookie обеспечивают работу корзины и входа. Аналитические и рекламные cookie включаются только с вашего согласия.',
        },
      ],
    },
  },
  {
    slug: 'qaytarish',
    title: { uz: 'Qaytarish', ru: 'Возврат' },
    subtitle: { uz: 'Almashtirish va pulni qaytarish', ru: 'Обмен и возврат денег' },
    body: {
      uz: [
        {
          type: 'dl',
          items: [
            {
              term: 'Qaytariladi',
              desc: 'Ochilmagan, plombasi butun mahsulot — {returns.returnDays} kun ichida.',
            },
            {
              term: 'Almashtiriladi',
              desc: "Nuqsonli yoki yo'lda shikastlangan mahsulot — foto bilan {returns.defectReportHours} soat ichida xabar bering.",
            },
            {
              term: 'Qaytarilmaydi',
              desc: "Ochilgan bo'yoq va sprey, buyurtma asosida aralashtirilgan rang.",
            },
          ],
        },
        { type: 'h2', text: 'Qanday qaytariladi' },
        {
          type: 'list',
          ordered: true,
          items: [
            'Kabinetda buyurtmani tanlab «Qaytarish» ni bosing yoki Telegram botga yozing.',
            "Kuryer mahsulotni o'zi olib ketadi (Toshkent) yoki BTS filialiga topshirasiz (viloyat).",
            "Pul to'lov qilingan usulga {returns.refundBusinessDays} ish kuni ichida qaytadi.",
          ],
        },
      ],
      ru: [
        {
          type: 'dl',
          items: [
            {
              term: 'Возвращается',
              desc: 'Невскрытый товар с целой пломбой — в течение {returns.returnDays} дней.',
            },
            {
              term: 'Обменивается',
              desc: 'Бракованный или повреждённый при доставке товар — сообщите с фото в течение {returns.defectReportHours} часов.',
            },
            {
              term: 'Не возвращается',
              desc: 'Вскрытые краска и спрей, цвет, смешанный под заказ.',
            },
          ],
        },
        { type: 'h2', text: 'Как вернуть' },
        {
          type: 'list',
          ordered: true,
          items: [
            'Выберите заказ в личном кабинете и нажмите «Возврат» или напишите в Telegram-бот.',
            'Курьер заберёт товар сам (Ташкент) или вы сдадите его в отделение BTS (регионы).',
            'Деньги вернутся тем же способом оплаты в течение {returns.refundBusinessDays} рабочих дней.',
          ],
        },
      ],
    },
  },
  {
    slug: 'yetkazish-tolov',
    title: { uz: "Yetkazish va to'lov", ru: 'Доставка и оплата' },
    subtitle: { uz: 'Hududlar, muddat, narx', ru: 'Регионы, сроки, стоимость' },
    // Zone table is rendered live from delivery settings (not stored here) to avoid stale prices.
    body: {
      uz: [
        {
          type: 'p',
          text: 'Toshkentda {delivery.cutoff} gacha tasdiqlangan buyurtma shu kuni yetkaziladi, keyinroq — ertasi kuni {delivery.afterCutoffBy} gacha. Viloyatlarga — BTS filialigacha yoki eshikkacha.',
        },
        { type: 'h2', text: "To'lov usullari" },
        { type: 'list', ordered: false, items: ['Payme', 'Click', 'Olganda naqd yoki karta'] },
      ],
      ru: [
        {
          type: 'p',
          text: 'Заказы, подтверждённые в Ташкенте до {delivery.cutoff}, доставляем в тот же день, позже — на следующий день до {delivery.afterCutoffBy}. В регионы — до отделения BTS или до двери.',
        },
        { type: 'h2', text: 'Способы оплаты' },
        {
          type: 'list',
          ordered: false,
          items: ['Payme', 'Click', 'Наличными или картой при получении'],
        },
      ],
    },
  },
];

/** Home FAQ from Main.dc.html. Answers with unknown facts ([sertifikat], [muddat]) are omitted until provided. */
export const homeFaq: { uz: { q: string; a: string }[]; ru: { q: string; a: string }[] } = {
  uz: [
    {
      q: "O'zim eplay olamanmi?",
      a: "Ha. Tajriba kerak emas. Har bir to'plam bilan video qo'llanma beriladi, savol bo'lsa Telegram'da yordam beramiz.",
    },
    {
      q: "Hid bo'ladimi, bolalarga zararli emasmi?",
      a: "Bo'yoq suv asosida va hidsiz, uy ichida bo'yash mumkin.",
    },
    {
      q: 'Natija yoqmasa-chi?',
      a: 'Ochilmagan qadoqni {returns.returnDays} kun ichida qaytarib olamiz.',
    },
  ],
  ru: [
    {
      q: 'Справлюсь ли я сам?',
      a: 'Да. Опыт не нужен. К каждому набору прилагается видеоинструкция, а если будут вопросы — поможем в Telegram.',
    },
    {
      q: 'Есть ли запах, не вредно ли для детей?',
      a: 'Краска на водной основе, без запаха — можно красить в квартире.',
    },
    {
      q: 'А если результат не понравится?',
      a: 'Невскрытую упаковку примем обратно в течение {returns.returnDays} дней.',
    },
  ],
};

export const selectorItems: {
  key: string;
  name: L;
  kind: L;
  photo: string;
  title: L;
  contents: L;
  items: { sku: string; qty: number }[];
  area: L;
  time: L;
  sort: number;
}[] = [
  {
    key: 'komod',
    name: { uz: 'Komod', ru: 'Комод' },
    kind: { uz: "Mebel · bo'yoq", ru: 'Мебель · краска' },
    photo: 'white-dresser.jpg',
    title: { uz: "Mebel yangilash to'plami", ru: 'Набор для обновления мебели' },
    contents: {
      uz: "Chalk White 1 L, Himoya mumi 250 ml, Oval 40 cho'tka",
      ru: 'Chalk White 1 л, защитный воск 250 мл, кисть Oval 40',
    },
    items: [{ sku: 'FR-KIT-F', qty: 1 }],
    area: { uz: '≈ 3 m²', ru: '≈ 3 м²' },
    time: { uz: '2–3 soat', ru: '2–3 часа' },
    sort: 1,
  },
  {
    key: 'shkaf',
    name: { uz: 'Shkaf', ru: 'Шкаф' },
    kind: { uz: "Mebel · bo'yoq", ru: 'Мебель · краска' },
    photo: 'shkaf.jpg',
    title: { uz: 'Chalk White 2,5 L + mum + valik', ru: 'Chalk White 2,5 л + воск + валик' },
    contents: {
      uz: 'Chalk White 2,5 L, Himoya mumi 500 ml, Mikrofibra valik',
      ru: 'Chalk White 2,5 л, защитный воск 500 мл, валик из микрофибры',
    },
    items: [
      { sku: 'FR-CW-2500', qty: 1 },
      { sku: 'FR-WX-0500', qty: 1 },
      { sku: 'FR-RL-10', qty: 1 },
    ],
    area: { uz: '≈ 8 m²', ru: '≈ 8 м²' },
    time: { uz: '4–5 soat', ru: '4–5 часов' },
    sort: 2,
  },
  {
    key: 'stol',
    name: { uz: 'Stol', ru: 'Стол' },
    kind: { uz: "Mebel · bo'yoq", ru: 'Мебель · краска' },
    photo: 'stol.jpg',
    title: { uz: "Mebel yangilash to'plami", ru: 'Набор для обновления мебели' },
    contents: {
      uz: "Chalk White 1 L, Himoya mumi 250 ml, Oval 40 cho'tka",
      ru: 'Chalk White 1 л, защитный воск 250 мл, кисть Oval 40',
    },
    items: [{ sku: 'FR-KIT-F', qty: 1 }],
    area: { uz: '≈ 2,5 m²', ru: '≈ 2,5 м²' },
    time: { uz: '2 soat', ru: '2 часа' },
    sort: 3,
  },
  {
    key: 'oshxona',
    name: { uz: 'Oshxona fasadi', ru: 'Кухонный фасад' },
    kind: { uz: "Mebel · bo'yoq", ru: 'Мебель · краска' },
    photo: 'oshxona.jpg',
    title: { uz: 'Chalk White 2,5 L + mum 500 ml', ru: 'Chalk White 2,5 л + воск 500 мл' },
    contents: {
      uz: 'Chalk White 2,5 L, Himoya mumi 500 ml',
      ru: 'Chalk White 2,5 л, защитный воск 500 мл',
    },
    items: [
      { sku: 'FR-CW-2500', qty: 1 },
      { sku: 'FR-WX-0500', qty: 1 },
    ],
    area: { uz: '≈ 6 m²', ru: '≈ 6 м²' },
    time: { uz: '1 kun', ru: '1 день' },
    sort: 4,
  },
  {
    key: 'divan',
    name: { uz: 'Divan', ru: 'Диван' },
    kind: { uz: 'Mato · sprey', ru: 'Ткань · спрей' },
    photo: 'classic-green-sofa.jpg',
    title: { uz: "Divan yangilash to'plami", ru: 'Набор для обновления дивана' },
    contents: {
      uz: "Mato tozalovchi 500 ml va 3 ta mato bo'yog'i spreyi, rangini o'zingiz tanlaysiz",
      ru: 'Очиститель для ткани 500 мл и 3 спрея-краски, цвет выбираете сами',
    },
    items: [{ sku: 'FR-KIT-S', qty: 1 }],
    area: { uz: '≈ 4 m²', ru: '≈ 4 м²' },
    time: { uz: '3 soat', ru: '3 часа' },
    sort: 5,
  },
  {
    key: 'kreslo',
    name: { uz: 'Kreslo', ru: 'Кресло' },
    kind: { uz: 'Mato · sprey', ru: 'Ткань · спрей' },
    photo: 'kreslo.jpg',
    title: { uz: 'Tozalovchi + 2 sprey', ru: 'Очиститель + 2 спрея' },
    contents: {
      uz: "Mato tozalovchi 500 ml va 2 ta mato bo'yog'i spreyi",
      ru: 'Очиститель для ткани 500 мл и 2 спрея-краски',
    },
    items: [
      { sku: 'FR-CL-0500', qty: 1 },
      { sku: 'FR-FS-OLV', qty: 2 },
    ],
    area: { uz: '≈ 2 m²', ru: '≈ 2 м²' },
    time: { uz: '1,5 soat', ru: '1,5 часа' },
    sort: 6,
  },
];

/** Bot/SMS templates (docs/09). Variables: {ism} {mahsulot} {raqam} {kod} {link} {vaqt}. */
export const messageTemplates: {
  key: string;
  body: L;
  buttons?: { text: L; url: string }[];
  delayMin?: number;
  smsFallback?: boolean;
  /** Eskiz-approved SMS text (CLAUDE.md §6 messaging engine); default false. */
  smsApproved?: boolean;
  /** Drafts the owner switches on after approval; default true. */
  active?: boolean;
}[] = [
  {
    key: 'otp',
    body: {
      uz: 'Forest: kirish kodi {kod}. Hech kimga bermang.',
      ru: 'Forest: код входа {kod}. Никому не сообщайте.',
    },
    smsFallback: true,
    smsApproved: true,
  },
  {
    key: 'lead_welcome',
    body: {
      uz: 'Assalomu alaykum! Birinchi buyurtmangizga −10%: {kod}. Kod 7 kun amal qiladi.',
      ru: 'Здравствуйте! Скидка −10% на первый заказ: {kod}. Код действует 7 дней.',
    },
    buttons: [{ text: { uz: 'Buyumni tanlash ↗', ru: 'Выбрать вещь ↗' }, url: '{link}' }],
  },
  {
    key: 'lead_promo_sms',
    body: {
      uz: 'Forest: birinchi buyurtmaga −10% promokod {kod}. 7 kun amal qiladi. {link}',
      ru: 'Forest: промокод −10% на первый заказ {kod}. Действует 7 дней. {link}',
    },
    smsFallback: true,
    smsApproved: true,
  },
  {
    key: 'order_created',
    body: {
      uz: 'Forest: buyurtma {raqam} qabul qilindi. Kuzatish: {link}',
      ru: 'Forest: заказ {raqam} принят. Отслеживание: {link}',
    },
    buttons: [{ text: { uz: 'Kuzatish ↗', ru: 'Отследить ↗' }, url: '{link}' }],
    smsFallback: true,
    smsApproved: true,
  },
  {
    key: 'order_paid',
    body: {
      uz: "Forest: to'lov qabul qilindi, buyurtma {raqam} yig'ilmoqda. Kuzatish: {link}",
      ru: 'Forest: оплата получена, заказ {raqam} собирается. Отслеживание: {link}',
    },
    buttons: [{ text: { uz: 'Kuzatish ↗', ru: 'Отследить ↗' }, url: '{link}' }],
    smsFallback: true,
    smsApproved: true,
  },
  {
    // COD: the operator confirmed the order by phone (no payment yet — docs/02).
    key: 'order_confirmed',
    body: {
      uz: "Forest: buyurtma {raqam} tasdiqlandi, to'lov kuryerga. Kuzatish: {link}",
      ru: 'Forest: заказ {raqam} подтверждён, оплата курьеру. Отслеживание: {link}',
    },
    buttons: [{ text: { uz: 'Kuzatish ↗', ru: 'Отследить ↗' }, url: '{link}' }],
    smsFallback: true,
    smsApproved: true,
  },
  {
    key: 'order_courier',
    body: {
      uz: "Forest: kuryer yo'lda, taxminan {vaqt} da yetib boradi. Kuzatish: {link}",
      ru: 'Forest: курьер в пути, прибудет примерно в {vaqt}. Отслеживание: {link}',
    },
    buttons: [{ text: { uz: 'Kuzatish ↗', ru: 'Отследить ↗' }, url: '{link}' }],
    smsFallback: true,
    smsApproved: true,
  },
  {
    // Handed to the courier when the carrier gives no ETA (else order_courier with {vaqt}).
    key: 'order_shipped',
    body: {
      uz: "Forest: buyurtma {raqam} kuryerga topshirildi, yo'lda. Kuzatish: {link}",
      ru: 'Forest: заказ {raqam} передан курьеру и уже в пути. Отслеживание: {link}',
    },
    buttons: [{ text: { uz: 'Kuzatish ↗', ru: 'Отследить ↗' }, url: '{link}' }],
    smsFallback: true,
    smsApproved: true,
  },
  {
    key: 'order_delivered',
    body: {
      uz: "Yetkazildi. Bo'yashdan oldin 4 daqiqalik qo'llanmani ko'ring: natija ancha yaxshi chiqadi.",
      ru: 'Доставлено. Перед покраской посмотрите 4-минутную инструкцию — результат будет заметно лучше.',
    },
    buttons: [{ text: { uz: "Video qo'llanma ↗", ru: 'Видеоинструкция ↗' }, url: '{link}' }],
    smsFallback: true,
    smsApproved: true,
  },
  {
    key: 'payment_reminder',
    body: {
      uz: "Forest: buyurtma {raqam} to'lovi yakunlanmadi. Mahsulot yana {vaqt} band turadi. To'lash: {link}",
      ru: 'Forest: оплата заказа {raqam} не завершена. Товар зарезервирован ещё на {vaqt}. Оплатить: {link}',
    },
    buttons: [{ text: { uz: "To'lash ↗", ru: 'Оплатить ↗' }, url: '{link}' }],
    smsFallback: true,
    smsApproved: true,
  },
  {
    key: 'cart_abandoned_2h',
    body: {
      uz: '{ism}, savatingizda qoldi: {mahsulot}. Bugun {kod} kodi bilan −5%.',
      ru: '{ism}, в корзине остался товар: {mahsulot}. Сегодня −5% по коду {kod}.',
    },
    buttons: [{ text: { uz: 'Buyurtmani yakunlash ↗', ru: 'Завершить заказ ↗' }, url: '{link}' }],
    delayMin: 120,
    smsFallback: false,
  },
  {
    key: 'cart_abandoned_24h_sms',
    body: {
      uz: 'Forest: savatingiz saqlangan. {kod} kodi bilan −5%: {link}',
      ru: 'Forest: ваша корзина сохранена. −5% по коду {kod}: {link}',
    },
    delayMin: 1440,
    smsFallback: true,
  },
  {
    key: 'advice_received',
    body: {
      uz: 'Rasm qabul qilindi. Mutaxassisimiz 5 daqiqa ichida javob beradi.',
      ru: 'Фото получено. Наш специалист ответит в течение 5 минут.',
    },
  },
  {
    key: 'advice_off_hours',
    body: {
      uz: 'Rasm qabul qilindi. Ertalab 9:00 da javob beramiz.',
      ru: 'Фото получено. Ответим утром в 9:00.',
    },
  },
  {
    key: 'review_request',
    body: {
      uz: '{ism}, natija qanday chiqdi? Baholang:',
      ru: '{ism}, как получился результат? Оцените:',
    },
    delayMin: 4320,
  },
  {
    key: 'review_thanks_high',
    body: {
      uz: 'Rahmat! Natija fotosini yuboring: keyingi xaridingizga −5% beramiz.',
      ru: 'Спасибо! Пришлите фото результата — дадим −5% на следующую покупку.',
    },
  },
  {
    key: 'review_photo_code',
    body: {
      uz: "Ajoyib natija! Kodingiz: {kod}. Fotoni saytdagi «Natijalar» bo'limiga qo'yishga ruxsat berasizmi?",
      ru: 'Отличный результат! Ваш код: {kod}. Разрешите разместить фото в разделе «Результаты» на сайте?',
    },
  },
  {
    key: 'review_low_apology',
    body: {
      uz: "Kechirasiz, natija kutganingizdek chiqmadi. Operatorimiz hozir siz bilan bog'lanadi.",
      ru: 'Извините, что результат не оправдал ожиданий. Наш оператор сейчас свяжется с вами.',
    },
  },
  {
    key: 'waitlist_back',
    body: {
      uz: '{mahsulot} yana omborda! Buyurtma bering: {link}',
      ru: '{mahsulot} снова в наличии! Заказать: {link}',
    },
    smsFallback: true,
  },
  {
    // BTS manual mode: the parcel was handed to BTS ({trek} = BTS waybill number).
    key: 'order_shipped_bts',
    body: {
      uz: "Forest: buyurtma {raqam} BTS orqali jo'natildi, trek raqam {trek}. Kuzatish: {link}",
      ru: 'Forest: заказ {raqam} отправлен через BTS, трек-номер {trek}. Отслеживание: {link}',
    },
    buttons: [{ text: { uz: 'Kuzatish ↗', ru: 'Отследить ↗' }, url: '{link}' }],
    smsFallback: true,
    smsApproved: true,
  },
  {
    // BTS branch delivery: the parcel waits at {filial} (branch name/address).
    key: 'order_at_branch',
    body: {
      uz: 'Forest: buyurtma {raqam} BTS filialiga yetib keldi: {filial}. Kuzatish: {link}',
      ru: 'Forest: заказ {raqam} прибыл в отделение BTS: {filial}. Отслеживание: {link}',
    },
    buttons: [{ text: { uz: 'Kuzatish ↗', ru: 'Отследить ↗' }, url: '{link}' }],
    smsFallback: true,
    smsApproved: true,
  },
  {
    key: 'order_delivery_failed',
    body: {
      uz: "Forest: buyurtma {raqam}ni yetkazib bo'lmadi. Operator siz bilan bog'lanadi. Kuzatish: {link}",
      ru: 'Forest: не удалось доставить заказ {raqam}. Оператор свяжется с вами. Отслеживание: {link}',
    },
    buttons: [{ text: { uz: 'Kuzatish ↗', ru: 'Отследить ↗' }, url: '{link}' }],
    smsFallback: true,
    smsApproved: true,
  },
  {
    // SMS fallback of flow 5 for customers without Telegram ({link} = tracking page).
    key: 'review_request_sms',
    body: {
      uz: 'Forest: {ism}, buyurtma {raqam} natijasi qanday chiqdi? Baho qoldiring: {link}',
      ru: 'Forest: {ism}, как результат по заказу {raqam}? Оставьте оценку: {link}',
    },
    delayMin: 4320,
    smsFallback: true,
  },
  {
    // Draft: staff/auto cancellation notice (CLAUDE.md §6 staff cancel). Owner activates it.
    key: 'order_cancelled',
    body: {
      uz: "Forest: buyurtma {raqam} bekor qilindi. Savollar bo'lsa, bizga yozing: {link}",
      ru: 'Forest: заказ {raqam} отменён. Если есть вопросы, напишите нам: {link}',
    },
    smsFallback: true,
    active: false,
  },
  {
    // Draft: confirmation of an order the operator placed by phone (`source = 'phone'`).
    key: 'order_phone_created',
    body: {
      uz: 'Forest: telefon orqali buyurtma {raqam} qabul qilindi. Kuzatish: {link}',
      ru: 'Forest: заказ {raqam}, оформленный по телефону, принят. Отслеживание: {link}',
    },
    buttons: [{ text: { uz: 'Kuzatish ↗', ru: 'Отследить ↗' }, url: '{link}' }],
    smsFallback: true,
    active: false,
  },
];

export const promoCodes = [
  {
    code: 'SALOM10',
    type: 'PERCENT' as const,
    value: 10,
    audience: 'FIRST_ORDER' as const,
    perCustomerLimit: 1,
    utmSource: 'lead',
  },
  {
    code: 'SAVAT5',
    type: 'PERCENT' as const,
    value: 5,
    audience: 'ALL' as const,
    perCustomerLimit: 1,
    utmSource: 'abandoned_cart',
  },
  {
    code: 'RAHMAT5',
    type: 'PERCENT' as const,
    value: 5,
    audience: 'ALL' as const,
    perCustomerLimit: 1,
    utmSource: 'review_photo',
  },
];

/** Normalized search synonyms (see normalizeSearch). Cyrillic is transliterated automatically. */
export const synonyms: { term: string; synonyms: string[] }[] = [
  { term: 'kraska', synonyms: ['boyoq', 'boyog', 'paint'] },
  { term: 'boyoq', synonyms: ['kraska', 'paint'] },
  { term: 'divan', synonyms: ['mato', 'tkan', 'sofa', 'kreslo'] },
  { term: 'tkan', synonyms: ['mato'] },
  { term: 'mebel', synonyms: ['komod', 'shkaf', 'stol', 'mebeli'] },
  { term: 'vosk', synonyms: ['mum'] },
  { term: 'kist', synonyms: ['chotka'] },
  { term: 'valek', synonyms: ['valik'] },
  { term: 'ochistitel', synonyms: ['tozalovchi'] },
];
