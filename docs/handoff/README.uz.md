# Forest — Claude Code uchun to'liq paket

## Ishlatish (3 qadam)
1. ZIP'ni bo'sh papkaga oching, masalan `~/projects/forest`.
2. (Ixtiyoriy) Brendbook PDF'ni `design/brandbook/` papkasiga qo'ying.
3. Terminalda shu papkaga kirib `claude` ni ishga tushiring va **`PROMPT.md` dagi chiziqdan pastki matnni to'liq** yuboring.

Claude Code avval hamma hujjat va ekranlarni o'qiydi, sizga o'zbekcha qisqa reja yuboradi, keyin 0-bosqichdan boshlab qurishga kirishadi. Har bosqich oxirida hisobot beradi va sizdan nima kerakligini aytadi.

## Ichida nima bor
| Fayl / papka | Mazmuni |
|---|---|
| `PROMPT.md` | Claude Code uchun bitta katta asosiy prompt |
| `CLAUDE.md` | Loyiha bilim bazasi: stack, qarorlar, qoidalar, buyruqlar, xatolar |
| `docs/01–14` | Talablar, biznes qoidalari, arxitektura, ma'lumotlar bazasi, API, integratsiyalar, analitika, admin, bot, SEO, dizayn tizimi, bosqichlar, ochiq savollar, xavfsizlik |
| `prisma/schema.prisma` | Ma'lumotlar bazasi sxemasi (tekshirilgan) |
| `design/screens/` | 46 ta ekran PNG (desktop 1440, mobil 390) |
| `design/source/` | Dizayn manbasi: aniq o'lchamlar, matnlar, holatlar |
| `design/assets/` | Logo, Payme/Click/BTS/Yandex logolari, ikonlar, foto (stok — almashtiriladi) |
| `.env.example` | Muhit o'zgaruvchilari shabloni (sirlarsiz) |

## Sizdan kerak bo'ladigan narsalar
`docs/13-open-questions.md` da 20 ta savol bor. Eng muhimlari:
- Payme, Click, Yandex Delivery, BTS, MoySklad, Eskiz shartnomalari va test kalitlari;
- naqd to'lov uchun fiskal chek yechimi (buxgalter bilan);
- yuridik ma'lumotlar va oferta matnini yurist ko'rishi;
- haqiqiy narxlar, IKPU kodlari, mahsulot va oldin/keyin fotolari;
- domen, server (shaxsiy ma'lumotlar qonuni bo'yicha O'zbekistonda bo'lishi kerak — yurist bilan tasdiqlang).

Kalitlar va parollarni chatga yoki kodga yozmang. Ular admin panelning "Integratsiyalar" bo'limiga kiritiladi va shifrlangan holda saqlanadi.

## Muhim
- Hujjatlar ingliz tilida yozilgan (Claude Code uchun aniqroq). Claude Code siz bilan o'zbekcha gaplashadi.
- Ish katta: bir necha uzun sessiya kerak bo'ladi. Har sessiya boshida Claude Code `CLAUDE.md` va `docs/progress.md` ni o'qib, davom ettiradi. Kerak bo'lsa: "CLAUDE.md va docs/progress.md ni o'qi, keyingi bosqichni davom ettir" deb yozing.
