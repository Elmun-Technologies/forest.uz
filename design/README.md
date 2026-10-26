# Design package

Source of truth for the UI. Build pixel-faithful to these screens, but implement with production components (see `docs/11-design-system.md`).

## Folders

| Folder | What | How to use |
|---|---|---|
| `screens/*.png` | Full-page renders of every screen (desktop 1440 px, mobile 390 px) in their **default state** | Look at these first. Open with the image viewer / Read tool. |
| `source/*.dc.html` | Design source: exact spacing, colors, copy, sample data and interactive states | Read for exact values (font sizes, radii, paddings) and all UZ copy. Not production code. |
| `source/canvas.json` | Board index: titles, sizes, layout on the design canvas | Lookup only. |
| `assets/` | Logo, partner logos, integration icons, photos | Copy what is needed into `apps/web/public` / object storage. |

### Live preview of the design (interactive states)
`source/` includes its runtime (`support.js`, `dc-runtime.js`). Serve the `design/` folder over HTTP and open any board:
```
cd design && python3 -m http.server 8777
# open http://localhost:8777/source/Main.dc.html  (or use Playwright to screenshot states)
```
Opening the files directly via `file://` won't work (components are fetched).

### How to read a `.dc.html` file
It is a small template format, not React:
- `{{path.to.value}}` – value injected from the `renderVals()` return object at the bottom of the file (`<script type="text/x-dc">`). The sample data (products, prices, orders, copy variants) lives there.
- `<sc-for list="{{items}}" as="x">` – loop; `<sc-if value="{{flag}}">` – conditional block.
- `<dc-import name="AdminNav" active="orders">` – embeds another board (`AdminNav.dc.html`) as a component with props.
- `this.state` / `setState` – the interactive states (tabs, selected rows, toggles, steps). Every state you see there must exist in the real UI.
- Inline `style="..."` are the exact design values. Translate them into Tailwind tokens; do **not** copy inline styles into production.
- Text in `[square brackets]` and the yellow **"Namuna"** badge = placeholder data/content that must come from the database or be confirmed by the owner (see `docs/13-open-questions.md`). Never hardcode it.

## Screen index

### Storefront (desktop 1440)
| # | Screen | File | Route |
|---|---|---|---|
| 00 | Site map & requirements | `Talablar` | – (spec board) |
| 01 | Home | `Main` | `/{locale}` |
| 02 | Catalog | `Katalog` | `/{locale}/katalog`, `/{locale}/katalog/[category]` |
| 03 | Product | `Mahsulot` | `/{locale}/p/[slug]` |
| 04 | Cart | `Savat` | `/{locale}/savat` |
| 05 | Checkout | `Checkout` | `/{locale}/checkout` |
| 06 | Order received | `Buyurtma` | `/{locale}/buyurtma/[publicId]` |
| 07 | Account (cabinet) | `Kabinet` | `/{locale}/kabinet/*` |
| 08 | Inspiration & guides | `Ilhom` | `/{locale}/ilhom`, `/{locale}/ilhom/[slug]` |
| 09 | About brand | `Brend` | `/{locale}/brend` |
| 10 | Login (SMS OTP / Telegram) | `Kirish` | `/{locale}/kirish` |
| 07L | Legal: offer, privacy, returns, delivery & payment | `Huquqiy` | `/{locale}/oferta`, `/maxfiylik`, `/qaytarish`, `/yetkazish-tolov` |
| 08T | Order tracking (no login) | `Kuzatish` | `/t/[trackingToken]` |
| 09E | Error & edge states (payment failed, out of stock + waitlist, empty cart, 404, no search results, form errors, offline) | `Holatlar` | various |
| – | Header / Footer components | `Header`, `Footer` | layout |
| – | Exit-intent lead popup | `Popup` | global |
| – | UI audit (CRO changes and why) | `Audit` | – (rationale board) |

### Storefront (mobile 390) – mobile-first, most traffic
| Screen | File |
|---|---|
| Home | `Mobil-Bosh` |
| Catalog + filter bottom sheet | `Mobil-Katalog` |
| Product + sticky buy bar | `Mobil-Mahsulot` |
| Cart | `Mobil-Savat` |
| Checkout | `Mobil-Checkout` |

### Admin panel (`admin.forest.uz`, desktop 1440, must stay usable on tablet)
| # | Screen | File | Route |
|---|---|---|---|
| – | Sidebar nav (component) | `AdminNav` | layout |
| A1 | Dashboard | `Admin-Dashboard` | `/` |
| A2 | Analytics (first-party) | `Admin-Analitika` | `/analytics` |
| A3 | Heatmaps & session replay | `Admin-Heatmap` | `/heatmaps` |
| A4 | Customers (CRM list) | `Admin-Mijozlar` | `/customers` |
| A5 | Customer 360° profile + journey | `Admin-Mijoz` | `/customers/[id]` |
| A6 | Orders list | `Admin-Buyurtmalar` | `/orders` |
| A7 | Order detail + journey/attribution | `Admin-Buyurtma` | `/orders/[id]` |
| A8 | Audiences & retargeting | `Admin-Auditoriya` | `/audiences` |
| A9 | SEO center | `Admin-SEO` | `/seo` |
| A10 | Integrations hub | `Admin-Integratsiya` | `/integrations` |
| A11 | Products | `Admin-Mahsulotlar` | `/products` |
| A12 | Telegram bot & messages | `Admin-Bot` | `/bot` |
| A13 | MoySklad sync | `Admin-MoySklad` | `/integrations/moysklad` |
| A14 | Promo codes & automatic promotions | `Admin-Promo` | `/promo` |
| A15 | Reviews & result photos moderation | `Admin-Sharhlar` | `/reviews` |
| A16 | Settings: staff & roles, delivery zones, store/legal, audit log | `Admin-Sozlamalar` | `/settings/*` |

### Telegram service bot (mobile 390, Telegram UI mock)
| Screen | File |
|---|---|
| Flow map (all 5 scenarios) | `Bot-Xarita` |
| 1 Lead + promo code | `Bot-1-Lead` |
| 2 Order status | `Bot-2-Holat` |
| 3 Abandoned cart | `Bot-3-Savat` |
| 4 Color advice (operator handoff) | `Bot-4-Operator` |
| 5 Review + result photo | `Bot-5-Sharh` |

## Assets
- `assets/brand/` – Forest logo (green, white). The full brandbook PDF is **not** in this package – the owner will add it to `design/brandbook/`. If present, it overrides anything here.
- `assets/logos/` – Payme, Click, BTS, Yandex Delivery (light + dark backgrounds). Use only in payment/delivery context.
- `assets/icons/` – integration icons for the admin Integrations hub. Local services without an icon (MoySklad, 1C, Billz, Uzum, Paynet, Eskiz, OFD…) use letter-mark tiles as drawn; replace with official logos later.
- `assets/photos/` – **stock placeholders** (free stock, mostly Pexels). Replace with real product packshots and real before/after photos before launch. Product images must be managed in admin, never hardcoded.
