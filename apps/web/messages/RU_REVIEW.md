# RU copy — strings for owner review

Russian copy was written for the storefront screens (home, catalog, product, header/footer,
popup, consent). Please confirm or correct:

| Key | RU | Question |
|---|---|---|
| `header.topTashkent` / `home.delivery.tashkentTextShort` | «Яндекс Экспресс» | Official carrier name in RU marketing: «Яндекс Доставка», «Яндекс Экспресс» or «Яндекс Go»? |
| `header.nav.fabric` | «Для дивана» | UZ says «Divan uchun» but the category is «Mato uchun» (fabric). Keep «Для дивана» or use «Для ткани»? |
| `header.nav.inspiration` | «Идеи» | Section «Ilhom» — «Идеи», «Вдохновение» or «Блог»? (hidden until the page exists) |
| `home.titleLine1-3` | «Старая мебель / как новая / за один день.» | Hero headline tone OK? |
| `home.ctaSelect` | «Подобрать краску» | Shorter than UZ «Buyumimga bo'yoq tanlash» (literal: «Подобрать краску для моей вещи») — OK? |
| `home.facts.*` | «грунт и шлифовка — не нужны», «без запаха», «2 слоя», «произведено в Европе» | Claims must match certificates. |
| `product.specs.eu` | «ЕС» | UZ tile shows «EI» (Yevropa Ittifoqi). Keep «ЕС» or write «Европа»? |
| `popup.text` | «…будет действовать 7 дней» | Promo validity (7 days) also in UZ — confirm with promo settings. |
| `catalog.quizMeta` | «3 вопроса · 20 секунд» | Copied from the design; the home selector is currently one step. Keep? |
| `footer.copyright` | «Цены указаны с НДС.» | Confirm VAT status of the legal entity. |
| `card.soon` / `product.soon` | «Скоро в продаже» | UZ «Tez orada» (literally «Скоро»). OK for out-of-stock items? |
| `consent.*` | banner text | Lawyer review together with the privacy policy. |

## Phase 1 flow pages (cart, checkout, order, tracking, login, cabinet, legal)

| Key | RU | Question |
|---|---|---|
| `cartPage.official` | «Forest · официально» (overline above the cart line) | UZ «Forest · rasmiy». Prefer «официальный продавец»? (too long for the overline) |
| `cartPage.freeLeft` | «До бесплатной доставки ещё 54 000 сум» | OK? |
| `checkout.title` / `checkout.metaTitle` | «Оформление» / «Оформление заказа» | H1 shortened to fit the design width. |
| `checkout.consentMarketing` | «Согласен(на) получать акции и новости по SMS» | Gendered «(на)» acceptable, or rephrase «Хочу получать…»? |
| `checkout.methods.COD.*` | «При получении», «Курьеру наличными или картой» | Confirm card-on-delivery is really available (fiscal/COD provider TBD). |
| `checkout.codLimit` | «Для заказа больше 3 000 000 сум нужна онлайн-оплата» | Wording of the COD limit. |
| `order.leadCod` | «Оператор позвонит в течение 15 минут для подтверждения» | 15 minutes is a promise — confirm operator SLA (also in UZ). |
| `order.failedText` | «…забронирован до сегодня, 13:26» | Time comes from the reservation; reads a bit mechanical. |
| `track.linkNote` | «Открывается без входа · ссылка в SMS и в боте» | OK? |
| `account.since` | «Клиент с 26.10.2026» | OK? |
| `account.consents.*` | «SMS: акции и новости», «Персонализация рекламы» + hints | Lawyer review together with the privacy policy (consent wording). |
| `account.deleteConfirm` | «…История заказов хранится столько, сколько требует закон» | Lawyer: retention wording. |
| `legal.title` / `legal.draft` | «Условия и политики» / «Черновик. Перед публикацией текст проверит юрист…» | OK? |
| `login.terms` | «условия использования» (links to the offer) | We have no separate «terms of use» page — the link opens the public offer. Rename to «публичную оферту»? Same question for UZ «foydalanish shartlari». |
| `common.carrier.*` | «Яндекс Экспресс», «BTS Почта», «Самовывоз» | Same question as `header.topTashkent`. |

## Phase 2 storefront (Telegram login, courier, BTS)

| Key | RU | Question |
|---|---|---|
| `telegram.login` / `telegram.link` | «Войти через Telegram» / «Привязать Telegram» | The visible button inside the official widget is Telegram's own text (language from `data-lang`); ours is the placeholder until it loads. OK? |
| `account.telegramHint` | «Привяжите аккаунт Telegram — в следующий раз войдёте без SMS-кода.» | OK? |
| `track.courierYandex` | «{name} · курьер Яндекса» | Same carrier-name question as `header.topTashkent` («Яндекс Доставка»?). |
| `track.callExt` | «После соединения добавочный: {ext}» | Wording for the Yandex forwarded number's extension. |
| `track.callLogin` | «Номер курьера виден только владельцу заказа. Войти» | OK? |
| `track.branchTitle` | «Ждёт в отделении» | BTS calls it «филиал» — «Ждёт в филиале BTS»? |
| `track.addressLocked` | «Адрес уже передан службе доставки, изменить его на сайте нельзя. Напишите в Telegram-бот или позвоните оператору.» | OK? |
| Privacy (CMS seed, `maxfiylik`) | Telegram login data sentence (UZ + RU) | **Lawyer:** confirm the wording of the data received from Telegram (Telegram ID, name, username, photo link) in «Что собираем». Lives in the CMS seed, editable in admin later. |
