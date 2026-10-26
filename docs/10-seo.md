# 10 · SEO

Owner requirement: SEO controlled **from the admin panel** (A9), including Search Console / Yandex Webmaster verification codes — no code deploys for SEO changes.

## Rendering & URLs
- All public pages SSR/ISR (Next.js). Product/category pages revalidate on change (on-demand revalidation from API).
- URLs: `/{uz|ru}/katalog/{category}`, `/{uz|ru}/p/{slug}`, `/{uz|ru}/ilhom/{slug}`, legal pages. Slugs Latin, lowercase, hyphenated; RU slugs may be transliterated (same slug for both locales is acceptable — hreflang handles it).
- `hreflang` uz ↔ ru + `x-default` (uz); self canonical; filters/sorting → `noindex,follow` + canonical to base category (except whitelisted filter landing pages); pagination `?page=n` self-canonical.
- Trailing slash policy consistent; 301 for changed slugs automatically (store old slug → `Redirect`).

## Admin-controlled (A9)
- Per page & locale: title (≤ 60), description (≤ 160), OG image, noindex, canonical override; SERP preview with rating/price/stock rich-result preview; **"AI bilan taklif"** (Claude drafts title/description, human saves).
- Defaults/templates: product `"{name} — narxi, sotib olish | Forest"`; RU `"{name} — цена, купить | Forest"`; description from short description + delivery/payment USP.
- sitemap.xml auto (index + per locale/type), regenerated on publish and daily 06:00; robots.txt editable; 301 redirects manager (hits); **404 log** with "create redirect" suggestion; IndexNow ping (Yandex, Bing) on publish/update.
- Verification meta codes: Google, Yandex, Bing (stored in settings, rendered in `<head>`).
- Schema.org templates toggles: Product + Offer + AggregateRating (only real approved reviews), Organization + LocalBusiness, BreadcrumbList, FAQPage, HowTo/VideoObject (off initially).
- SEO health score (critical/warnings): missing titles/descriptions, duplicates, long titles, missing alt, noindex mistakes, broken links, CWV fails.
- Core Web Vitals (mobile) from our `web_vitals` events (field data) + optional PageSpeed API (lab).
- Search queries from GSC API & Yandex Webmaster API: query, clicks, impressions, CTR, position; daily sync.

## Content SEO
- Category SEO text blocks (UZ/RU), FAQ blocks, Ilhom articles (how to paint a dresser, recolor a sofa, color guides) targeting real queries in both languages (incl. Cyrillic/Latin variants and common misspellings like "kraska", "краска для дивана").
- Image alt texts per locale; WebP/AVIF; width/height set (CLS).
- Internal linking: product ↔ guide ↔ kit.

## Search on site
Postgres `pg_trgm` + `unaccent` + synonym dictionary (UZ Latin/Cyrillic transliteration, RU, typos: kraska/kraska/bo'yoq/краска) — zero-result queries logged and shown in A9/A2.
