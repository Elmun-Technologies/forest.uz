/**
 * Sample catalog from the design (`Admin-Mahsulotlar`, `Katalog`). Prices and stock are SAMPLE —
 * real values come from MoySklad. IKPU is a flagged placeholder (all zeros) until the owner provides codes.
 * Photos are free stock placeholders (design/assets/photos) and must be replaced before launch.
 */
export const IKPU_PLACEHOLDER = '00000000000000000';

type L = { uz: string; ru: string };

export interface SeedCategory {
  slug: string;
  name: L;
  photo: string;
  sort: number;
  seoText: L;
}

export const categories: SeedCategory[] = [
  {
    slug: 'mebel-uchun',
    name: { uz: 'Mebel uchun', ru: 'Для мебели' },
    photo: 'white-dresser.jpg',
    sort: 1,
    seoText: {
      uz: "Yog'och, MDF va lakli yuzalar uchun matli Chalk paint grunt va jilvirlashsiz yopadi. Kerakli miqdorni mahsulot sahifasidagi kalkulyator yordamida hisoblang.",
      ru: 'Матовая краска Chalk paint ложится на дерево, МДФ и лакированные поверхности без грунта и шлифовки. Нужное количество рассчитайте калькулятором на странице товара.',
    },
  },
  {
    slug: 'mato-uchun',
    name: { uz: 'Mato uchun', ru: 'Для ткани' },
    photo: 'green-fabric.jpg',
    sort: 2,
    seoText: {
      uz: "Divan va kreslo matosi uchun tolaga singadigan sprey: rangni tiklaydi va matoni qattiq qilmaydi. Bo'yashdan oldin matoni tozalovchi bilan tozalang.",
      ru: 'Спрей для обивки диванов и кресел проникает в волокна: обновляет цвет и не делает ткань жёсткой. Перед окрашиванием очистите ткань очистителем.',
    },
  },
  {
    slug: 'aksessuarlar',
    name: { uz: 'Aksessuarlar', ru: 'Аксессуары' },
    photo: 'brushes-jar.jpg',
    sort: 3,
    seoText: {
      uz: "Tekis qatlam uchun to'g'ri cho'tka va valik: iz qoldirmaydi va bo'yoqni tejaydi.",
      ru: 'Правильная кисть и валик для ровного слоя: не оставляют следов и экономят краску.',
    },
  },
  {
    slug: 'toplamlar',
    name: { uz: "To'plamlar", ru: 'Наборы' },
    photo: 'white-shelf-bedroom.jpg',
    sort: 4,
    seoText: {
      uz: "Tayyor to'plamlarda bo'yoq, himoya va asboblar bir qutida — alohida olishdan arzonroq.",
      ru: 'В готовых наборах краска, защита и инструменты в одной коробке — дешевле, чем по отдельности.',
    },
  },
];

export interface SeedVariant {
  sku: string;
  label: L;
  priceSoum: number;
  compareAtSoum?: number;
  stock: number;
  volumeMl?: number;
  colorHex?: string;
  weightGrams?: number;
  lowStockAt?: number;
}

export interface SeedProduct {
  slug: string;
  type: 'SIMPLE' | 'BUNDLE';
  category: string;
  name: L;
  shortDesc: L;
  description: L;
  howToApply?: L;
  specs?: { key: L; value: L }[];
  badges: ('HIT' | 'NEW' | 'SALE')[];
  surfaces: string[];
  coverageM2PerL?: number;
  dryTimeMinutes?: number;
  isBestseller: boolean;
  bestsellerSort?: number;
  popularity: number;
  photos: { file: string; alt: L }[];
  variants: SeedVariant[];
  /** For bundles: component SKUs with qty. */
  components?: { sku: string; qty: number }[];
  synonyms?: string[];
}

export const products: SeedProduct[] = [
  {
    slug: 'chalk-white',
    type: 'SIMPLE',
    category: 'mebel-uchun',
    name: { uz: "Chalk White mebel bo'yog'i", ru: 'Краска для мебели Chalk White' },
    shortDesc: {
      uz: "Matli oq bo'yoq. Yog'och, MDF va lakli yuzani grunt va jilvirlashsiz yopadi. Quriganda baxmal kabi matli yuza hosil qiladi.",
      ru: 'Матовая белая краска. Покрывает дерево, МДФ и лак без грунта и шлифовки. После высыхания даёт бархатистую матовую поверхность.',
    },
    description: {
      uz: "Eski komod, shkaf yoki stolni yangisini sotib olmasdan, bir kunda zamonaviy oq rangga keltiring.\n\nChalk White yuza bilan mahkam bog'lanadi, shuning uchun ko'pchilik hollarda grunt va jilvirlash kerak bo'lmaydi. Yaltiroq lakda yengil jilvirlash natijani yaxshilaydi.\n\nOshxona fasadi va stol usti kabi tez-tez ushlanadigan yuzalarni Himoya mumi Clear bilan qoplash tavsiya etiladi.",
      ru: 'Обновите старый комод, шкаф или стол в современный белый цвет за один день — без покупки новой мебели.\n\nChalk White прочно сцепляется с поверхностью, поэтому в большинстве случаев грунт и шлифовка не нужны. На глянцевом лаке лёгкая шлифовка улучшит результат.\n\nКухонные фасады и столешницы, которых часто касаются руками, рекомендуем покрыть защитным воском Clear.',
    },
    howToApply: {
      uz: 'Yuzani artib, tutqichlarni yeching. Polni plyonka bilan yoping.\nYupqa qatlam surting, 1 soat kuting, ikkinchisini surting.\n24 soatdan keyin mum bilan himoya qiling.',
      ru: 'Протрите поверхность и снимите ручки. Застелите пол плёнкой.\nНанесите тонкий слой, подождите 1 час, нанесите второй.\nЧерез 24 часа защитите воском.',
    },
    specs: [
      {
        key: { uz: 'Mos yuzalar', ru: 'Поверхности' },
        value: { uz: "Yog'och, MDF, DSP, lak, metall", ru: 'Дерево, МДФ, ДСП, лак, металл' },
      },
      { key: { uz: 'Yuza', ru: 'Финиш' }, value: { uz: 'Matli', ru: 'Матовый' } },
      {
        key: { uz: "To'liq qurish", ru: 'Полное высыхание' },
        value: { uz: '24 soat', ru: '24 часа' },
      },
      {
        key: { uz: 'Asbob', ru: 'Инструмент' },
        value: { uz: "Cho'tka, valik", ru: 'Кисть, валик' },
      },
    ],
    badges: ['HIT'],
    surfaces: ['wood', 'lacquer', 'metal'],
    coverageM2PerL: 11,
    dryTimeMinutes: 60,
    isBestseller: true,
    bestsellerSort: 2,
    popularity: 188,
    photos: [
      {
        file: 'white-dresser.jpg',
        alt: {
          uz: "Chalk White bilan bo'yalgan oq komod",
          ru: 'Белый комод, окрашенный Chalk White',
        },
      },
      {
        file: 'brush-hand.jpg',
        alt: { uz: "Cho'tka bilan bo'yash jarayoni", ru: 'Окрашивание кистью' },
      },
      {
        file: 'parquet.jpg',
        alt: {
          uz: "Yog'och yuzaga bo'yoq surtish",
          ru: 'Нанесение краски на деревянную поверхность',
        },
      },
      {
        file: 'white-shelf-bedroom.jpg',
        alt: { uz: 'Yangilangan oq mebel yotoqxonada', ru: 'Обновлённая белая мебель в спальне' },
      },
    ],
    variants: [
      {
        sku: 'FR-CW-0500',
        label: { uz: '0,5 L', ru: '0,5 л' },
        priceSoum: 189_000,
        stock: 22,
        volumeMl: 500,
        weightGrams: 700,
      },
      {
        sku: 'FR-CW-1000',
        label: { uz: '1 L', ru: '1 л' },
        priceSoum: 329_000,
        stock: 41,
        volumeMl: 1000,
        weightGrams: 1350,
      },
      {
        sku: 'FR-CW-2500',
        label: { uz: '2,5 L', ru: '2,5 л' },
        priceSoum: 749_000,
        stock: 6,
        volumeMl: 2500,
        weightGrams: 3300,
      },
    ],
    synonyms: ['kraska', 'boyoq', 'mebel kraska', 'chalk paint', 'mel kraska'],
  },
  {
    slug: 'mato-boyogi-spreyi',
    type: 'SIMPLE',
    category: 'mato-uchun',
    name: { uz: "Mato bo'yog'i spreyi", ru: 'Спрей-краска для ткани' },
    shortDesc: {
      uz: 'Divan va kreslo matosi rangini tiklaydi. Tolaga singadi, matoni qattiq qilmaydi.',
      ru: 'Восстанавливает цвет обивки дивана и кресла. Проникает в волокна, не делает ткань жёсткой.',
    },
    description: {
      uz: "Velur, paxta va aralash matolar uchun sprey-bo'yoq. Bir divan uchun odatda 3 ballon yetadi. Bo'yashdan oldin Mato tozalovchi bilan tozalang — aks holda rang notekis chiqadi.",
      ru: 'Спрей-краска для велюра, хлопка и смесовых тканей. На один диван обычно хватает 3 баллонов. Перед окрашиванием очистите ткань очистителем — иначе цвет ляжет неравномерно.',
    },
    howToApply: {
      uz: 'Matoni tozalovchi bilan tozalang va 2 soat quriting.\n20–30 sm masofadan yupqa qatlam seping.\n1 soatdan keyin ikkinchi qatlam seping, 24 soat quriting.',
      ru: 'Очистите ткань очистителем и дайте высохнуть 2 часа.\nРаспылите тонкий слой с расстояния 20–30 см.\nЧерез час нанесите второй слой, сушите 24 часа.',
    },
    specs: [
      {
        key: { uz: 'Mos matolar', ru: 'Ткани' },
        value: { uz: 'Velur, paxta, aralash', ru: 'Велюр, хлопок, смесовые' },
      },
      { key: { uz: 'Hajmi', ru: 'Объём' }, value: { uz: '400 ml', ru: '400 мл' } },
      {
        key: { uz: "To'liq qurish", ru: 'Полное высыхание' },
        value: { uz: '24 soat', ru: '24 часа' },
      },
    ],
    badges: ['NEW'],
    surfaces: ['fabric'],
    isBestseller: true,
    bestsellerSort: 3,
    popularity: 236,
    photos: [
      {
        file: 'sprayer-hand.jpg',
        alt: { uz: "Mato bo'yog'i spreyi qo'lda", ru: 'Спрей-краска для ткани в руке' },
      },
      {
        file: 'green-velvet-living.jpg',
        alt: { uz: 'Yangilangan yashil velur divan', ru: 'Обновлённый зелёный велюровый диван' },
      },
    ],
    variants: [
      {
        sku: 'FR-FS-ANT',
        label: { uz: 'Antrasit', ru: 'Антрацит' },
        priceSoum: 249_000,
        stock: 38,
        volumeMl: 400,
        colorHex: '#3A3D40',
        weightGrams: 450,
      },
      {
        sku: 'FR-FS-OLV',
        label: { uz: 'Zaytun', ru: 'Оливковый' },
        priceSoum: 249_000,
        stock: 44,
        volumeMl: 400,
        colorHex: '#5B6B3A',
        weightGrams: 450,
      },
      {
        sku: 'FR-FS-BEJ',
        label: { uz: 'Bej', ru: 'Бежевый' },
        priceSoum: 249_000,
        stock: 31,
        volumeMl: 400,
        colorHex: '#CDB892',
        weightGrams: 450,
      },
      {
        sku: 'FR-FS-GRY',
        label: { uz: 'Kulrang', ru: 'Серый' },
        priceSoum: 249_000,
        stock: 19,
        volumeMl: 400,
        colorHex: '#8D918C',
        weightGrams: 450,
      },
    ],
    synonyms: ['divan kraska', 'kraska dlya divana', 'mato kraska', 'sprey'],
  },
  {
    slug: 'mato-tozalovchi',
    type: 'SIMPLE',
    category: 'mato-uchun',
    name: { uz: 'Mato tozalovchi sprey', ru: 'Очиститель для ткани' },
    shortDesc: {
      uz: "Bo'yashdan oldin matodagi dog' va yog'ni ketkazadi — rang tekis chiqadi.",
      ru: 'Удаляет пятна и жир с ткани перед окрашиванием — цвет ложится ровно.',
    },
    description: {
      uz: "Divan va kresloni bo'yashdan oldin majburiy qadam. Tozalovchisiz rang notekis chiqadi.",
      ru: 'Обязательный шаг перед окрашиванием дивана и кресла. Без очистителя цвет ложится неравномерно.',
    },
    badges: [],
    surfaces: ['fabric'],
    isBestseller: false,
    popularity: 171,
    photos: [
      {
        file: 'green-spray-bottle.jpg',
        alt: { uz: 'Mato tozalovchi sprey', ru: 'Спрей-очиститель для ткани' },
      },
    ],
    variants: [
      {
        sku: 'FR-CL-0500',
        label: { uz: '500 ml', ru: '500 мл' },
        priceSoum: 149_000,
        stock: 58,
        volumeMl: 500,
        weightGrams: 560,
      },
    ],
    synonyms: ['tozalovchi', 'ochistitel', 'divan tozalash'],
  },
  {
    slug: 'himoya-mumi-clear',
    type: 'SIMPLE',
    category: 'mebel-uchun',
    name: { uz: 'Himoya mumi Clear', ru: 'Защитный воск Clear' },
    shortDesc: {
      uz: "Bo'yalgan yuzani dog' va namlikdan saqlaydi.",
      ru: 'Защищает окрашенную поверхность от пятен и влаги.',
    },
    description: {
      uz: 'Chalk White ustidan suriladigan shaffof mum. Oshxona fasadi, stol usti va tez-tez ushlanadigan joylar uchun tavsiya etiladi.',
      ru: 'Прозрачный воск поверх Chalk White. Рекомендуется для кухонных фасадов, столешниц и мест, которых часто касаются.',
    },
    badges: [],
    surfaces: ['wood', 'lacquer'],
    isBestseller: false,
    popularity: 96,
    photos: [
      {
        file: 'wax-varnish.jpg',
        alt: {
          uz: "Mumni yog'och yuzaga surtish",
          ru: 'Нанесение воска на деревянную поверхность',
        },
      },
    ],
    variants: [
      {
        sku: 'FR-WX-0250',
        label: { uz: '250 ml', ru: '250 мл' },
        priceSoum: 159_000,
        stock: 4,
        volumeMl: 250,
        weightGrams: 300,
      },
      {
        sku: 'FR-WX-0500',
        label: { uz: '500 ml', ru: '500 мл' },
        priceSoum: 279_000,
        stock: 5,
        volumeMl: 500,
        weightGrams: 580,
      },
    ],
    synonyms: ['mum', 'vosk', 'lak'],
  },
  {
    slug: 'oval-40-chotka',
    type: 'SIMPLE',
    category: 'aksessuarlar',
    name: { uz: "Oval 40 cho'tka", ru: 'Кисть Oval 40' },
    shortDesc: {
      uz: '40 mm, aralash tola. Iz qoldirmaydi.',
      ru: '40 мм, смешанный ворс. Не оставляет полос.',
    },
    description: {
      uz: "Chalk paint uchun oval cho'tka: bo'yoqni yaxshi ushlaydi va tekis qatlam beradi.",
      ru: 'Овальная кисть для Chalk paint: хорошо набирает краску и даёт ровный слой.',
    },
    badges: [],
    surfaces: [],
    isBestseller: false,
    popularity: 88,
    photos: [{ file: 'brush-hand.jpg', alt: { uz: "Oval cho'tka", ru: 'Овальная кисть' } }],
    variants: [
      {
        sku: 'FR-BR-40',
        label: { uz: '40 mm', ru: '40 мм' },
        priceSoum: 119_000,
        stock: 64,
        weightGrams: 90,
      },
    ],
    synonyms: ['chotka', 'kist', 'kistochka'],
  },
  {
    slug: 'mikrofibra-valik-10',
    type: 'SIMPLE',
    category: 'aksessuarlar',
    name: { uz: 'Mikrofibra valik 10 sm', ru: 'Валик из микрофибры 10 см' },
    shortDesc: {
      uz: 'Ruchka bilan. Silliq sirt uchun.',
      ru: 'С ручкой. Для гладких поверхностей.',
    },
    description: {
      uz: "Katta tekis yuzalar (shkaf eshigi, stol usti) uchun: bo'yoqni tez va bir xil yoyadi.",
      ru: 'Для больших ровных поверхностей (дверцы шкафа, столешница): быстро и равномерно распределяет краску.',
    },
    badges: [],
    surfaces: [],
    isBestseller: false,
    popularity: 52,
    photos: [
      { file: 'painting-materials.jpg', alt: { uz: "Valik va bo'yoq", ru: 'Валик и краска' } },
    ],
    variants: [
      {
        sku: 'FR-RL-10',
        label: { uz: '10 sm', ru: '10 см' },
        priceSoum: 79_000,
        stock: 70,
        weightGrams: 120,
      },
    ],
    synonyms: ['valik', 'valek'],
  },
  {
    slug: 'mebel-yangilash-toplami',
    type: 'BUNDLE',
    category: 'toplamlar',
    name: { uz: "Mebel yangilash to'plami", ru: 'Набор для обновления мебели' },
    shortDesc: {
      uz: "Bo'yoq 1 L, mum va cho'tka — komod uchun hammasi bir qutida.",
      ru: 'Краска 1 л, воск и кисть — всё для комода в одной коробке.',
    },
    description: {
      uz: "Chalk White 1 L, Himoya mumi Clear 250 ml va Oval 40 cho'tka. Komod, tumba yoki stolni bir kunda yangilash uchun yetarli.",
      ru: 'Chalk White 1 л, защитный воск Clear 250 мл и кисть Oval 40. Хватает, чтобы за день обновить комод, тумбу или стол.',
    },
    badges: ['SALE'],
    surfaces: ['wood', 'lacquer'],
    isBestseller: true,
    bestsellerSort: 4,
    popularity: 74,
    photos: [
      {
        file: 'white-shelf-bedroom.jpg',
        alt: {
          uz: "Mebel yangilash to'plami bilan yangilangan mebel",
          ru: 'Мебель, обновлённая набором',
        },
      },
    ],
    variants: [
      {
        sku: 'FR-KIT-F',
        label: { uz: "To'plam", ru: 'Набор' },
        priceSoum: 549_000,
        compareAtSoum: 607_000,
        stock: 18,
        weightGrams: 1800,
      },
    ],
    components: [
      { sku: 'FR-CW-1000', qty: 1 },
      { sku: 'FR-WX-0250', qty: 1 },
      { sku: 'FR-BR-40', qty: 1 },
    ],
    synonyms: ['komod toplam', 'nabor dlya mebeli'],
  },
  {
    slug: 'divan-yangilash-toplami',
    type: 'BUNDLE',
    category: 'toplamlar',
    name: { uz: "Divan yangilash to'plami", ru: 'Набор для обновления дивана' },
    shortDesc: {
      uz: "Mato tozalovchi 500 ml va 3 ta mato bo'yog'i spreyi, rangini o'zingiz tanlaysiz.",
      ru: 'Очиститель для ткани 500 мл и 3 спрея-краски, цвет выбираете сами.',
    },
    description: {
      uz: 'Bir divanni yangilash uchun hammasi: tozalovchi va 3 ballon sprey. Rangni buyurtmada tanlaysiz.',
      ru: 'Всё для обновления одного дивана: очиститель и 3 баллона спрея. Цвет выбираете при заказе.',
    },
    badges: ['SALE'],
    surfaces: ['fabric'],
    isBestseller: true,
    bestsellerSort: 1,
    popularity: 142,
    photos: [
      {
        file: 'classic-green-sofa.jpg',
        alt: {
          uz: "Divan yangilash to'plami bilan bo'yalgan divan",
          ru: 'Диван, обновлённый набором',
        },
      },
    ],
    // Stock 0 on purpose: exercises the out-of-stock state (docs/04 seed).
    variants: [
      {
        sku: 'FR-KIT-S',
        label: { uz: "To'plam", ru: 'Набор' },
        priceSoum: 799_000,
        compareAtSoum: 896_000,
        stock: 0,
        weightGrams: 1950,
      },
    ],
    components: [
      { sku: 'FR-CL-0500', qty: 1 },
      { sku: 'FR-FS-OLV', qty: 3 },
    ],
    synonyms: ['divan toplam', 'nabor dlya divana', 'pokraska divana'],
  },
];

/** product slug → related slugs (cross-sell "Birga olinadi"). */
export const crossSell: Record<string, string[]> = {
  'chalk-white': [
    'himoya-mumi-clear',
    'oval-40-chotka',
    'mikrofibra-valik-10',
    'mebel-yangilash-toplami',
  ],
  'mato-boyogi-spreyi': ['mato-tozalovchi', 'divan-yangilash-toplami'],
  'mato-tozalovchi': ['mato-boyogi-spreyi', 'divan-yangilash-toplami'],
  'himoya-mumi-clear': ['chalk-white', 'oval-40-chotka'],
  'oval-40-chotka': ['chalk-white', 'mikrofibra-valik-10'],
  'mikrofibra-valik-10': ['chalk-white', 'oval-40-chotka'],
  'mebel-yangilash-toplami': ['mikrofibra-valik-10', 'himoya-mumi-clear'],
  'divan-yangilash-toplami': ['mato-tozalovchi', 'mato-boyogi-spreyi'],
};

/** Cart upsell rules ("Tozalovchisiz rang notekis chiqadi"). */
export const upsell: Record<string, string[]> = {
  'mato-boyogi-spreyi': ['mato-tozalovchi'],
  'chalk-white': ['himoya-mumi-clear'],
};

/** Out-of-stock alternatives ("Hozir bor muqobil"). */
export const alternatives: Record<string, string[]> = {
  'divan-yangilash-toplami': ['mato-boyogi-spreyi'],
};
