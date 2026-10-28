-- Phase 5B messaging engine (CLAUDE.md §6 "Messaging engine"): one send path with a policy,
-- deferred delivery (quiet hours), idempotent producers and Eskiz approval per template.

ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';

ALTER TABLE "MessageTemplate" ADD COLUMN "smsApproved" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Message"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'service',
  ADD COLUMN "sendAfter" TIMESTAMPTZ(3),
  ADD COLUMN "claimedAt" TIMESTAMPTZ(3),
  ADD COLUMN "dedupeKey" TEXT,
  ADD COLUMN "payload" JSONB;

UPDATE "Message" SET "kind" = 'marketing' WHERE "marketing" = true;

CREATE UNIQUE INDEX "Message_dedupeKey_key" ON "Message"("dedupeKey");
CREATE INDEX "Message_status_sendAfter_idx" ON "Message"("status", "sendAfter");

-- Texts sent by SMS before Phase 5 keep being sent: marked approved (owner verifies them against
-- the Eskiz cabinet — docs/13). New texts start unapproved.
UPDATE "MessageTemplate" SET "smsApproved" = true WHERE "key" IN (
  'otp', 'lead_promo_sms', 'order_created', 'order_paid', 'order_confirmed', 'order_courier',
  'order_shipped', 'order_delivered', 'payment_reminder', 'order_shipped_bts', 'order_at_branch',
  'order_delivery_failed'
);

-- Templates the automations and the bot send that only the seed inserted so far, plus the new
-- review SMS and two inactive drafts. Texts identical to packages/db/src/seed/data/content.ts
-- (unit test). Existing rows (seeded or edited in admin) are kept.
INSERT INTO "MessageTemplate" ("id", "key", "body", "buttons", "delayMin", "smsFallback", "active", "smsApproved", "updatedAt") VALUES
  ('tpl_lead_welcome', 'lead_welcome', '{"uz":"Assalomu alaykum! Birinchi buyurtmangizga −10%: {kod}. Kod 7 kun amal qiladi.","ru":"Здравствуйте! Скидка −10% на первый заказ: {kod}. Код действует 7 дней."}'::jsonb, '[{"text":{"uz":"Buyumni tanlash ↗","ru":"Выбрать вещь ↗"},"url":"{link}"}]'::jsonb, 0, false, true, false, CURRENT_TIMESTAMP),
  ('tpl_cart_abandoned_2h', 'cart_abandoned_2h', '{"uz":"{ism}, savatingizda qoldi: {mahsulot}. Bugun {kod} kodi bilan −5%.","ru":"{ism}, в корзине остался товар: {mahsulot}. Сегодня −5% по коду {kod}."}'::jsonb, '[{"text":{"uz":"Buyurtmani yakunlash ↗","ru":"Завершить заказ ↗"},"url":"{link}"}]'::jsonb, 120, false, true, false, CURRENT_TIMESTAMP),
  ('tpl_cart_abandoned_24h_sms', 'cart_abandoned_24h_sms', '{"uz":"Forest: savatingiz saqlangan. {kod} kodi bilan −5%: {link}","ru":"Forest: ваша корзина сохранена. −5% по коду {kod}: {link}"}'::jsonb, NULL, 1440, true, true, false, CURRENT_TIMESTAMP),
  ('tpl_advice_received', 'advice_received', '{"uz":"Rasm qabul qilindi. Mutaxassisimiz 5 daqiqa ichida javob beradi.","ru":"Фото получено. Наш специалист ответит в течение 5 минут."}'::jsonb, NULL, 0, false, true, false, CURRENT_TIMESTAMP),
  ('tpl_advice_off_hours', 'advice_off_hours', '{"uz":"Rasm qabul qilindi. Ertalab 9:00 da javob beramiz.","ru":"Фото получено. Ответим утром в 9:00."}'::jsonb, NULL, 0, false, true, false, CURRENT_TIMESTAMP),
  ('tpl_review_request', 'review_request', '{"uz":"{ism}, natija qanday chiqdi? Baholang:","ru":"{ism}, как получился результат? Оцените:"}'::jsonb, NULL, 4320, false, true, false, CURRENT_TIMESTAMP),
  ('tpl_review_thanks_high', 'review_thanks_high', '{"uz":"Rahmat! Natija fotosini yuboring: keyingi xaridingizga −5% beramiz.","ru":"Спасибо! Пришлите фото результата — дадим −5% на следующую покупку."}'::jsonb, NULL, 0, false, true, false, CURRENT_TIMESTAMP),
  ('tpl_review_photo_code', 'review_photo_code', '{"uz":"Ajoyib natija! Kodingiz: {kod}. Fotoni saytdagi «Natijalar» bo''limiga qo''yishga ruxsat berasizmi?","ru":"Отличный результат! Ваш код: {kod}. Разрешите разместить фото в разделе «Результаты» на сайте?"}'::jsonb, NULL, 0, false, true, false, CURRENT_TIMESTAMP),
  ('tpl_review_low_apology', 'review_low_apology', '{"uz":"Kechirasiz, natija kutganingizdek chiqmadi. Operatorimiz hozir siz bilan bog''lanadi.","ru":"Извините, что результат не оправдал ожиданий. Наш оператор сейчас свяжется с вами."}'::jsonb, NULL, 0, false, true, false, CURRENT_TIMESTAMP),
  ('tpl_waitlist_back', 'waitlist_back', '{"uz":"{mahsulot} yana omborda! Buyurtma bering: {link}","ru":"{mahsulot} снова в наличии! Заказать: {link}"}'::jsonb, NULL, 0, true, true, false, CURRENT_TIMESTAMP),
  ('tpl_review_request_sms', 'review_request_sms', '{"uz":"Forest: {ism}, buyurtma {raqam} natijasi qanday chiqdi? Baho qoldiring: {link}","ru":"Forest: {ism}, как результат по заказу {raqam}? Оставьте оценку: {link}"}'::jsonb, NULL, 4320, true, true, false, CURRENT_TIMESTAMP),
  ('tpl_order_cancelled', 'order_cancelled', '{"uz":"Forest: buyurtma {raqam} bekor qilindi. Savollar bo''lsa, bizga yozing: {link}","ru":"Forest: заказ {raqam} отменён. Если есть вопросы, напишите нам: {link}"}'::jsonb, NULL, 0, true, false, false, CURRENT_TIMESTAMP),
  ('tpl_order_phone_created', 'order_phone_created', '{"uz":"Forest: telefon orqali buyurtma {raqam} qabul qilindi. Kuzatish: {link}","ru":"Forest: заказ {raqam}, оформленный по телефону, принят. Отслеживание: {link}"}'::jsonb, '[{"text":{"uz":"Kuzatish ↗","ru":"Отследить ↗"},"url":"{link}"}]'::jsonb, 0, true, false, false, CURRENT_TIMESTAMP)

ON CONFLICT ("key") DO NOTHING;
