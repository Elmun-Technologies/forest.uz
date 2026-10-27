# 08 · Admin panel (A1–A16)

Domain `admin.forest.uz`. Layout: dark sidebar (`AdminNav`) + content panels. Screens in `design/screens/Admin-*.png`. All numbers in designs are sample data ("Namuna" badge) — wire to real queries. Every list: server-side filter/sort/pagination, URL-synced filters, CSV export where shown (permission-gated), empty & loading states.

Sidebar groups: **Asosiy** (Dashboard, Analitika [LIVE], Heatmap va sessiyalar) · **Savdo** (Buyurtmalar [count needing action], Mijozlar, Auditoriyalar, Telegram bot [unread]) · **Katalog** (Mahsulotlar, MoySklad, Sharhlar va fotolar [pending]) · **Marketing** (Promo-kodlar, SEO markazi, Integratsiyalar, Sozlamalar). Global search: order number, customer name, phone.

## A1 Dashboard
- Header: date, "N kishi hozir saytda" (realtime), report button.
- KPI tiles with deltas vs previous period (sessions, orders, revenue, CR, AOV, leads).
- Visits chart with 7/14/30-day switch (sessions + orders).
- **Attention required** list (priority-sorted): SLA risk orders (< 1 h left), low stock, metric anomalies (e.g. mobile bounce +8 % on product page), opportunities (abandoned carts → audience ready).
- Sales funnel with drop-off % per step. Traffic sources (sessions, CR, revenue). Latest orders. Top products (units, CR).

## A2 Analytics — see `07-analytics-tracking.md`
Tabs: Real-time · Sources & UTM (with imported spend & ROAS) · Landing/exit · Events & goals (with insight text) · Devices & regions · Repeat purchase cohorts. Filters: device, source, period + compare.

## A3 Heatmaps & sessions
Page picker, device toggle, heatmap types (click/scroll/move), KPIs (sessions viewed, avg scroll, rage clicks, dead clicks), most-clicked elements, auto-detected problems, session list with filters (abandoned cart, purchased, rage click, leads) → rrweb player with event timeline. PII masked note.

## A4 Customers (CRM)
Segments chips (All, New 30 d, Loyal 2+/LTV 2 mln+, Abandoned cart 7 d, Inactive 60+ d, Leads only), filters (city, first source, bought product, LTV), table (customer, city, first source, orders, LTV, last activity, segment, consent SMS/TG), bulk actions (add to audience, send SMS, Telegram message, tag), import/export CSV (Owner), "+ Customer". Note: all data stored in Uzbekistan.

## A5 Customer 360°
Header (name, VIP tag, masked phone, city, since, ID, tags, actions: Telegram, SMS, create order). KPIs: LTV, orders, AOV, visit→purchase time, sessions, predicted next purchase. **Journey timeline** (ads click → visits with behavior summary → lead → bot chats → orders → delivery → review) with channel icons. Attribution summary (first/last touch, channels, CAC). Orders list. Audiences membership. Consents with dates. Data download / delete (Owner).

## A6 Orders
Status tabs with counts (to pack, in transit, delivered, **SLA risk**, awaiting payment, cancelled), filters (payment, carrier, source), table rows with SLA countdown ("6 soat 18 daq qoldi" / "Kechikmoqda"), payment badge (Payme/Click/Naqd + paid/wait), carrier logo, source/campaign, status. Manual order creation (phone orders), export.

## A7 Order detail & journey
Header (number, status, created, PDF receipt, cancel). SLA bar (deadline). Items, totals. Payment block (transaction id, time, masked card, refund). Delivery block (carrier status, call courier, print label, address, receiver). Status stepper with action buttons (confirm payment for COD, start packing, call Yandex courier, mark delivered) — each writes `OrderEvent`. System log + internal note. Customer card (VIP, nth order, LTV). **Order journey** with attribution model switch (first / linear / last) showing revenue share per touch. "View purchase session" (replay). Next automated steps (review request in 3 days, upsell audience in 21 days).

## A8 Audiences & retargeting
List of segments (size, last refresh, destinations, auto-message, result). Editor: rule builder (AND groups of conditions), live size (with phone, with Telegram), destinations (Meta, Google Customer Match, TikTok, Yandex Direct, Telegram, SMS) with hashing/consent note, automatic message (template + delay), 30-day result (CR, ROAS).

## A9 SEO center — see `10-seo.md`
## A10 Integrations hub — see `06-integrations.md`
Header "N / M ulangan"; dark **launch-kit** panel with progress and chips; search + category chips (All, Connected, Payment, Delivery, Inventory & ERP, CRM, Marketplace & feeds, Tax & fiscal, Messaging, Ads, SEO, Automation & AI); detail panel (logo, status, description, credential fields masked, test, connect/disconnect, deep link to dedicated page); card grid; outbound webhooks table (event, destination, 24 h count) + API key; key security panel.

## A11 Products
KPIs (active products/variants, low stock, feeds connected, missing IKPU). Search + category chips; table (image, name, SKU, variants count, price "dan …", stock badge, 30-day sales, status). Editor panel tabs: **Main** (UZ/RU name, category, badge, sales channels: site / Meta catalog / Google Merchant / Telegram), **Variants** (label, SKU, IKPU, price, stock — price/stock read-only when MoySklad is connected, note shown), **Images** (drag-sort, video, alt UZ/RU), **SEO** (SERP preview, link to SEO center). Seller field "Forest · rasmiy". View on site, Save. AI description draft button.

## A12 Telegram bot — see `09-telegram-bot.md`
KPIs (subscribers, phones collected, bot orders, bot revenue, unsubscribe rate). Scenarios table with on/off switches and 30-day metrics. Template editor (UZ/RU text, variables `{ism} {mahsulot} {raqam} {kod} {link} {vaqt}`, live preview bubble + button, delay, SMS fallback, test-to-myself). Operator inbox (status: new, answered, complaint, closed). Settings (hours, off-hours reply, operators, languages, message cap, masked token).

## A13 MoySklad
Status + "sync now", KPIs (last sync, linked SKUs, orders pushed today, errors). Data flows with direction, frequency and on/off. Field mapping table. Rules (conflicts, zero stock behavior, reservation, warehouse). Connection (masked token, webhook URL). Sync log (time, entity, message, OK/Error).

## A14 Promo codes
KPIs (orders with code %, discount given, revenue from codes, suspicious uses). Table (code, discount, source, uses, revenue, status). Editor (type: percent/fixed/free shipping/gift; value; min cart; audience; limits; dates; UTM source). Protection rules (no stacking, margin guard ≤ 15 %, one per phone/device). Automatic promotions (free shipping thresholds, kit pricing, 2nd purchase gift).

## A15 Reviews & photos
KPIs (avg rating, verified count, % with photo, open ≤3★ complaints). Filter by state (pending/approved/rejected). Review cards: customer, source (site/bot), product+variant, order link, rating, text, photos, "verified purchase", photo consent; actions approve/reject/public reply/add to gallery. **Results gallery** manager with drag ordering and before/after pairing (used on Home and Product).

## A16 Settings
Tabs: **Staff** (invite, role, last login, 2FA status) + roles/permissions matrix · **Delivery** (zones table: zone, carrier, ETA, price, free-from; rules: free threshold, Tashkent cut-off 18:00, after-cutoff promise, COD limit, Sunday rule; preview of storefront texts) · **Store** (name, domain, languages, currency, phone, hours, Telegram; legal entity, STIR, offer version, data location, cookie banner, deletion SLA). Activity (audit) log at bottom.

## Cross-cutting admin requirements
- Realtime updates (SSE/WebSocket) for new orders, inbox messages, SLA alerts; browser + Telegram admin-group notifications.
- Keyboard shortcuts on lists (j/k, enter) — nice to have.
- All destructive actions confirm + audit log; PII reveal logged.
- Responsive down to 1024 px (tablet); critical order actions usable on mobile.
