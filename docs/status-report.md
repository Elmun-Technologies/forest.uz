# Forest — loyiha holati va to'lov integratsiyalari (2026-11-12)

> Mijozga taqdim etish uchun hujjat (o'zbek tilida). Texnik tafsilotlar: `docs/progress.md`,
> `docs/runbooks/payments.md`, ochiq savollar: `docs/13-open-questions.md`.

## 1. Qisqacha

Forest — Evropa mebel va mato bo'yoqlari onlayn do'koni (UZ/RU): sayt, admin panel va Telegram bot.
Rejadagi **6 bosqichning hammasi kodda tayyor** (0–6). Loyiha hozir **ishga tushirishga tayyorlanish**
bosqichida: kod tayyor, endi haqiqiy ma'lumotlar (mahsulotlar, narxlar, IKPU), to'lov tizimlari
kalitlari va server sozlamalari kiritilishi kerak.

| Bosqich | Nima | Holat |
|---|---|---|
| 0 | Poydevor: monorepo, ma'lumotlar bazasi, dizayn tizimi, CI | ✅ tayyor |
| 1 | Sayt: bosh sahifa, katalog, mahsulot, savat, buyurtma, kuzatish, kabinet | ✅ tayyor |
| 2 | To'lovlar (Payme, Click, naqd), SMS (Eskiz), Telegram login, yetkazib berish (Yandex, BTS), fiskal chek | ✅ tayyor |
| 3 | Admin panel: buyurtmalar, mahsulotlar, mijozlar, promo, sharhlar, sozlamalar, MoySklad | ✅ tayyor |
| 4 | O'z analitikamiz, issiqlik xaritalari, sessiya yozuvlari, auditoriyalar, SEO markazi | ✅ tayyor |
| 5 | Telegram bot, avtomatik xabarlar, webhooklar, kontent (Ilhom, Brend), AI yordamchi | ✅ tayyor |
| 6 | Xavfsizlik, zaxira nusxa, monitoring, yuklama testi, deploy skriptlari | ✅ tayyor |

## 2. Nima tayyor (mijoz ko'zi bilan)

**Sayt (telefon va kompyuter, o'zbek va rus tillarida)**
- Katalog filtrlar bilan, mahsulot sahifasi (galereya, variantlar, bo'yoq kalkulyatori), qidiruv
  (lotin/kirill farqisiz), savat, promo-kodlar (SALOM10, SAVAT5, RAHMAT5), buyurtma berish.
- To'lov: **Payme, Click yoki naqd (kuryerga)**. Buyurtma holatini SMS-havola orqali kuzatish,
  kuryer ma'lumoti, manzilni o'zgartirish.
- Kirish: SMS-kod yoki Telegram orqali. Shaxsiy kabinet: buyurtmalar, manzillar, sevimlilar.
- Huquqiy sahifalar (oferta, maxfiylik, qaytarish) — yurist tekshiruvi kutilmoqda.

**Admin panel**
- Buyurtmalar (holatlar, SLA vaqti, kuryer chaqirish, qaytarish, chek kiritish, telefon orqali buyurtma).
- Mahsulotlar (variantlar, rasmlar, IKPU, SEO), promo-kodlar, sharhlar moderatsiyasi.
- Mijozlar bazasi (CRM, segmentlar, eksport), xodimlar va rollar (5 rol), audit jurnali.
- Analitika (tashrif, voronka, manbalar, daromad), issiqlik xaritalari, sessiya yozuvlari.
- SEO markazi, auditoriyalar (Meta/Google/TikTok/Yandex reklamasi uchun), Telegram bot va xabarlar.
- Integratsiyalar markazi: barcha kalitlar shifrlangan holda faqat Egasi tomonidan kiritiladi.

**Telegram bot**: lid yig'ish, buyurtma holati, maslahat (operator inbox), sharh to'plash,
tashlab ketilgan savat eslatmasi, admin guruhiga ogohlantirishlar.

**Xavfsizlik va ishonchlilik**: admin uchun 2 bosqichli kirish (TOTP), ruxsatlar har bir amalda
tekshiriladi, shaxsiy ma'lumotlar maskalangan, avtomatik zaxira nusxa va tiklash mashqi, xatolar
monitoringi, deployda avtomatik orqaga qaytish. OWASP ASVS L2 tekshiruvi: yuqori xavf yopilgan;
12-noyabrda yana 3 ta past xavf yopildi (sessiya kalitini almashtirish, shaxsiy javoblarni
keshlamaslik, Click uchun IP ro'yxati). 2 ta o'rta xavf egasining qarorida: SMS kodni 6 xonali
qilish va 2FA'ni barcha xodimlarga majburiy qilish (`docs/security/asvs-l2.md`).

## 3. To'lov integratsiyalari

### 3.1 Payme (Merchant API)

**Qanday ishlaydi** — mijoz "Payme" ni tanlaydi → Payme sahifasiga yo'naltiriladi
(`checkout.paycom.uz`, buyurtma raqami, summa tiyinda) → Payme bizning serverga quyidagi
so'rovlarni yuboradi:

| Usul | Bizda nima bo'ladi |
|---|---|
| `CheckPerformTransaction` | Buyurtma, summa va holat tekshiriladi; **fiskal chek ma'lumoti (`detail`)** qaytariladi |
| `CreateTransaction` | Tranzaksiya yaratiladi, mahsulot zaxirada ushlanadi (12 soat muddat) |
| `PerformTransaction` | Buyurtma "to'langan" bo'ladi, mijozga SMS, admin guruhiga xabar |
| `CancelTransaction` | To'lovdan oldin — bekor; to'lovdan keyin — pul qaytarish (kuryerga berilgan bo'lsa rad etiladi) |
| `CheckTransaction`, `GetStatement` | Payme tranzaksiya holatini va ro'yxatini so'raydi |
| `ChangePassword` | Payme kalitni almashtiradi (shifrlangan holda saqlanadi) |

**Fiskal chek (soliq aylanmasi uchun)** — `CheckPerformTransaction` javobida har bir mahsulot uchun:
`title` (nomi), `price` (birlik narxi, tiyin), `count`, `code` (**MXIK/IKPU**), `package_code`
(**o'lchov birligi / upakovka kodi** — `https://tasnif.soliq.uz/attribute/<MXIK>` da tekshiriladi),
`vat_percent` (**QQS %**), chegirma va yetkazib berish.

**2026-11-12 da rasmiy hujjat bilan qayta tekshirildi va tuzatildi:**
- `CheckPerformTransaction` faqat `-31001` va `-31050…-31099` xato kodlarini qaytarishi mumkin —
  "buyurtma to'langan / bekor qilingan / boshqa to'lov jarayonida" holatlari endi `-31051`,
  `-31052`, `-31053` kodlari bilan javob beradi (Payme sinov to'plami shuni kutadi).
- `package_code` majburiy maydon: IKPU yoki upakovka kodi yo'q mahsulot uchun chek ma'lumoti
  yuborilmaydi (Payme butun chekni rad etmasligi uchun) — bunday buyurtmaga chek qo'lda kiritiladi.

**Payme kabinetida sozlash**: Endpoint `https://<API_DOMEN>/v1/webhooks/payme`, hisob maydoni
`order_id` (qiymati buyurtma raqami, masalan `F-10482`). Admin → Integratsiyalar → Payme: Merchant ID,
kalit, test kaliti, rejim, "Chek ma'lumoti (IKPU) yuborish" = on.

### 3.2 Click (SHOP API + Merchant API)

**Qanday ishlaydi** — mijoz "Click" ni tanlaydi → `my.click.uz/services/pay` sahifasi (Click Up
foydalanuvchilari hisob-faktura orqali, **istalgan Uzcard/Humo karta egalari karta raqami bilan**
to'laydi — ikkala tugmaning vazifasini bitta havola bajaradi) → Click bizga yuboradi:

| Bosqich | Bizda nima bo'ladi |
|---|---|
| `Prepare` (action 0) | Imzo (md5), buyurtma, summa tekshiriladi; mahsulot zaxirada |
| `Complete` (action 1) | Buyurtma "to'langan", SMS, admin xabari; takroriy chaqiruv ikki marta to'lamaydi |

**Fiskalizatsiya (yangi, 2026-11-12)** — Click talabi: 1 tadan ortiq MXIK bo'lsa, har bir to'lov
cheki fiskallashtirilishi shart. Endi avtomatik:
1. To'lov tugagach, fon vazifasi har daqiqada Click Merchant API'ga
   (`ofd_data/submit_items`) buyurtma qatorlarini yuboradi: nomi, **MXIK (SPIC)**, **upakovka kodi**,
   narx, soni, **QQS summasi va foizi**, kompaniya **STIR** i (`CommissionInfo`), yetkazib berish qatori.
2. Click qaytargan **chek havolasi (QR)** to'lovga yoziladi — shu bilan buyurtmani yopish mumkin.
3. Xatoda qayta urinadi (1 daqiqadan 6 soatgacha), ma'lumot yetishmasa sababini yozadi va
   admin guruhiga ogohlantiradi; hech qachon chekni ikki marta yubormaydi.

**Click'ni ishga tushirish (menejer ko'rsatmasi bo'yicha)**:
1. Click test dasturida integratsiyani sinash.
2. merchant.click.uz → Сервисы → Действия: Prepare va Complete manzillarini kiritish
   (`https://<API_DOMEN>/v1/webhooks/click/prepare` va `…/complete`), so'ng Click'dan servisni
   **faollashtirishni** so'rash.
3. Server TAS-IX tarmog'ida emas → **domen, IP manzil va port (443)** ni Click'ga oq ro'yxat uchun
   yuborish. IP **statik** bo'lishi shart (hozirgi Hetzner IP statik); IP/domen o'zgarsa — oldindan
   Click'ga xabar berish.
4. Click Up ilovasi bilan 1 000 so'mlik sinov to'lovi:
   `https://my.click.uz/services/pay?service_id=<ID>&merchant_id=<ID>&amount=1000&transaction_param=<buyurtma raqami>`.
5. Admin → Integratsiyalar → Click: Service ID, Merchant ID, **Merchant user ID**, maxfiy kalit,
   rejim, fiskalizatsiya = on, **yetkazib berish IKPU, upakovka kodi, QQS %**.

### 3.3 Naqd (kuryerga)
Operator qo'ng'iroq qilib tasdiqlaydi; chek kuryer kassasida chiqariladi va admin panelga
kiritiladi (COD fiskal yechimi — buxgalter qarori kutilmoqda).

### 3.4 Har ikki to'lov tizimi uchun kerakli ma'lumotlar (Egadan)
- Har bir sotiladigan variant uchun **MXIK (17 raqam)** va **upakovka kodi** (Admin → Mahsulotlar).
- **QQS holati**: kompaniya QQS to'lovchisimi (12 %) yoki aylanma soliqdami (0 %).
- Kompaniya **STIR**, nomi, manzili, bank rekvizitlari (Admin → Sozlamalar → Do'kon).
- Yetkazib berish xizmati uchun MXIK + upakovka kodi (Click cheki uchun).
- Payme va Click shartnoma kalitlari (avval test rejimida).

## 4. Nima qolgan

**Egadan kerak (ishga tushirishni to'xtatib turgan narsalar)**
1. Haqiqiy mahsulotlar: rasmlar, narxlar, zaxira (yoki MoySklad ulanishi), MXIK + upakovka kodlari.
2. Payme, Click, Eskiz SMS, Telegram bot, Yandex Yetkazib berish kalitlari va shartnomalari.
3. Kompaniya rekvizitlari, yurist tekshirgan oferta / maxfiylik / qaytarish matnlari.
4. Eskiz'da SMS shablonlarini tasdiqlatish.
5. Domen nomi (hozircha sinov uchun bepul manzillar ishlatilmoqda).

**Texnik (biz)**
1. Hetzner serverda Coolify orqali to'liq stek (`infra/compose.coolify.yml`: API, sayt, admin,
   baza) ishlamoqda. Qolgan ish: Coolify'da yangi S3 kalitlari va generatsiya qilingan baza parolini
   o'rnatish (runbook `docs/runbooks/deploy-hetzner-coolify.md`, tepadagi eslatma).
2. Payme sinov to'plamini (sandbox) to'liq o'tkazish, Click test dasturi va 1 000 so'mlik sinovlar.
3. Zaxira nusxa va monitoringni yoqish, birinchi tiklash mashqi.
4. Ishga tushirish ro'yxati: `docs/launch-checklist.md`.

**Huquqiy**: O'zbekiston fuqarolarining shaxsiy ma'lumotlari O'zbekistondagi serverda saqlanishi
kerak. Hetzner — sinov/namoyish uchun; haqiqiy mijoz ma'lumotlari bilan ishlashdan oldin UZ
serverga ko'chish yoki yurist xulosasi kerak.

## 5. Mobil versiya

Tashrif buyuruvchilarning aksariyati telefondan kiradi — sayt "mobile-first" qilib qurilgan
(390 px dizayn, alohida mobil sarlavha va pastki tugmalar). Lighthouse mobil (5 marta, mediana,
ikkinchi audit): **Bosh sahifa 96, Katalog 93, Mahsulot 91** — maqsad 90.

**2026-11-12 mobil audit** (360 va 390 px, UZ + RU, 114 sahifa yuklanishi; to'liq hisobot —
`docs/mobile-audit.md`):

| Tekshiruv | Oldin | Hozir |
|---|---|---|
| Telefonda "kichrayib" ochiladigan sahifalar (sahifa ekrandan keng) | 4 (qidiruv) | 0 |
| iPhone'da maydonga bosganda sahifa kattalashib ketishi (shrift < 16 px) | 120 joy (checkout, savat, filtrlar, kabinet…) | 0 |
| 360 px telefonda mahsulot pastki "Savatga" paneli | narx sig'masdi | sig'adi |
| iPhone pastki chizig'i / Android imo-ishora paneli ostida qolgan tugmalar | himoya yo'q | barcha pastki panellar chetdan surilgan |
| Barmoq bilan bosiladigan kichik tugmalar (galereya nuqtalari, akkordeonlar, filtrlar, "+") | 8–36 px | 44 px (ko'rinishi o'zgarmadi) |
| Joy siljishi (CLS) | 0–0,007 | o'zgarmadi (ideal) |

Tezlik: birinchi yuklanadigan JS barcha sahifalarda 137–158 KB (chegara 170 KB).

**Ikkinchi bosqich (shu kuni, tavsiyalar bajarildi):**

1. **Telefonda lead-popup o'rniga pastdan ingichka panel** (52 px, ekranni yopmaydi): 40 soniyadan
   keyin, mahsulot / savat / checkout / kabinet sahifalarida chiqmaydi; "Olish" formani ochadi.
   Kompyuterda — avvalgidek, faqat chiqib ketayotganda.
2. **Cookie-banner ixchamlashdi**: 360 px ekranda 35 % dan **17 %** ga (UZ 126 px, RU 142 px), matn
   ma'nosi o'zgarmadi.
3. **Kulrang yordamchi matn kontrasti** 3,1:1 dan **5,3:1** ga (WCAG AA talabi 4,5:1).
4. Qolgan kichik tugmalar (chiplar, kalkulyator, hajm filtrlari, cookie tugmalari) — **44 px** bosish
   maydoni.
5. Mahsulot sahifasida pastki bloklarni kechiktirib yuklash sinab ko'rildi — o'lchovda foyda yo'q,
   qaytarildi (`docs/mobile-audit.md`).

**Hali tekshirilmagan:** haqiqiy iPhone/Android qurilmalarida, Telegram ichki brauzerida, sekin
3G tarmoqda — taqdimotdan oldin 2–3 ta haqiqiy telefonda qisqa sinov qilish kerak.

## 6. Taqdimot ssenariysi (demo)

1. Telefonda sayt: bosh sahifa → katalog → mahsulot → kalkulyator → savat → SALOM10 → buyurtma.
2. To'lov: Payme yoki Click sinov sahifasi → "to'landi" → SMS va kuzatish sahifasi.
3. Admin: buyurtma paydo bo'ldi, holatlar, kuryer, chek; analitikada tashrif va buyurtma ko'rinadi.
4. Telegram bot: /start, telefon ulash, buyurtma holati, sharh qoldirish.
