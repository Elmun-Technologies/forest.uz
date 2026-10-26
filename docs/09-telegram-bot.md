# 09 · Telegram service bot (@forest_uz_bot)

Principle: **the bot does not sell; it brings people back to the website.** Every button opens the right site page (cart restored, checkout prefilled). Screens: `design/screens/Bot-*.png`.

Tech: grammY in NestJS `bot` module, webhook mode, sessions in Redis, templates from DB (`MessageTemplate`, UZ/RU by customer locale), deep links `https://t.me/forest_uz_bot?start=<payload>` where payload is a short signed token (lead source, order token, cart id).

| # | Flow | Trigger | Bot message | Customer action | Admin/result |
|---|---|---|---|---|---|
| 1 | **Lead + promo** | Popup or site "Telegram" button (deep link with UTM) | Welcome, −10 % code `SALOM10` (7 days), copy button, "Buyumni tanlash ↗"; ask to share phone (request_contact keyboard) so code also comes by SMS and order statuses arrive here | Shares phone → thanks + invite to send item photo for color advice | Lead in CRM: phone + chat_id + source UTM; visitor ↔ customer stitched |
| 2 | **Order status** | Payment webhook, status changes, Yandex/BTS updates | Order accepted (items, total) → paid → courier on the way (name, masked phone, ETA) → delivered + 4-min video guide | "Kuzatish ↗" (tracking page), call courier, write operator | Fewer "where is my order" calls; each message logged in order timeline |
| 3 | **Abandoned cart** | Cart with items, no checkout for **2 h** (identified customer with Telegram) | Product image + price + `SAVAT5` (−5 %, valid till end of day), Yandex 12 h line; buttons: finish order ↗ (restored cart), "Savolim bor", "Eslatmani o'chirish". Second reminder at 24 h by SMS if no Telegram | Finish on site / ask question → operator | Returned vs not returned audiences (also Meta retargeting) |
| 4 | **Color advice (operator)** | Customer sends a photo or text | Auto: "Rasm qabul qilindi, mutaxassis 5 daqiqada javob beradi" (off-hours: "Ertalab 9:00 da javob beramiz") | Operator replies from admin inbox with colors + product card "Savatga ↗" | Conversation on customer profile; purchase attributed to Telegram channel |
| 5 | **Review + photo** | 3 days after `DELIVERED` | "Natija qanday chiqdi?" 1–5 stars inline buttons | 4–5★: ask photo → `RAHMAT5` (−5 % next order) → ask consent to publish in "Natijalar" · 1–3★: apology, operator notified immediately | Review → moderation (A15); consented photos → gallery |

## Rules
- Service messages (order status) always allowed. Marketing (cart, review request, promos): **max 1 per customer per day** across Telegram+SMS (A12 setting; bot map board says 2 — use the setting, default 1), quiet hours 21:00–09:00, every marketing message has "Eslatmani o'chirish" (unsubscribe) → consent revoked.
- Language: customer locale (from site) else Telegram `language_code` (ru → RU, else UZ).
- Operator hours Mon–Sat 09:00–21:00 (settings). Operators: Madina, Sardor (sample). Complaint keywords or ≤3★ → admin group alert.
- SMS fallback via Eskiz for status messages when no Telegram chat (and for OTP).
- Bot commands: `/start`, `/buyurtmalar` (my orders), `/yordam` (operator), `/til` (language), `/stop` (unsubscribe marketing).
- Admin alerts group gets: new order, payment failed, SLA risk, ≤3★ review, complaint, integration errors.

## Data
`Customer.telegramId`, `Conversation`, `ConversationMessage`, `Message` (status, channel, template), consent records. Photos stored in object storage (download via Bot API `getFile`), never public until review approved with consent.
