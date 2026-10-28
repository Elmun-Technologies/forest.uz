-- Phase 5B review: the marketing SMS opt-out is a `{stop}` slot inside the template text, so the
-- whole SMS (opt-out included) is what Eskiz approves; no line is appended at send time any more.
-- Texts still equal to the original seed get the slot (identical to
-- packages/db/src/seed/data/content.ts — unit test) and lose any approval: the owner re-approves the
-- new wording in Eskiz (docs/13 q.88). Texts edited in admin are left alone; without `{stop}` the
-- engine refuses to send them by SMS (A12 asks to add it on save).
UPDATE "MessageTemplate" SET "body" = '{"uz":"Forest: savatingiz saqlangan. {kod} kodi bilan −5%: {link} Rad etish: {stop}","ru":"Forest: ваша корзина сохранена. −5% по коду {kod}: {link} Отписаться: {stop}"}'::jsonb, "smsApproved" = false, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "key" = 'cart_abandoned_24h_sms' AND "body" = '{"uz":"Forest: savatingiz saqlangan. {kod} kodi bilan −5%: {link}","ru":"Forest: ваша корзина сохранена. −5% по коду {kod}: {link}"}'::jsonb;
UPDATE "MessageTemplate" SET "body" = '{"uz":"Forest: {ism}, buyurtma {raqam} natijasi qanday chiqdi? Baho qoldiring: {link} Rad etish: {stop}","ru":"Forest: {ism}, как результат по заказу {raqam}? Оставьте оценку: {link} Отписаться: {stop}"}'::jsonb, "smsApproved" = false, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "key" = 'review_request_sms' AND "body" = '{"uz":"Forest: {ism}, buyurtma {raqam} natijasi qanday chiqdi? Baho qoldiring: {link}","ru":"Forest: {ism}, как результат по заказу {raqam}? Оставьте оценку: {link}"}'::jsonb;
