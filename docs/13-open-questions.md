# 13 · Open questions (owner must answer — do not invent)

Build with configurable defaults and clearly marked placeholders; list any new questions here.

## Business / legal
1. Legal entity name, STIR (TIN), address, bank details — for offer, receipts, footer.
2. Lawyer review of offer, privacy, returns texts (drafts in `design/source/Huquqiy.dc.html`). Exact return terms (14 days unopened?).
3. Fiscal solution for **cash on delivery** (OFD / online cash register provider) — accountant decision. Without it COD can't launch legally.
4. Hosting in Uzbekistan for personal data (which provider/DC) — confirm with lawyer.

## Product & pricing
5. Manufacturer name, country, certificates; product specs (coverage, drying time, shelf life) — currently `[brackets]`.
6. Final prices, volumes, colors; IKPU (MXIK) + package codes per SKU.
7. Real packshots (white background) and 5–10 real before/after photo pairs (same angle); 15-s vertical process video; video guides.
8. Kit compositions and kit prices.

## Delivery & payments
9. Delivery prices per zone; free-delivery threshold (500 000 everywhere, or 700 000 for regions?); Sunday rules; COD max amount.
10. Payme & Click merchant contracts (merchant id/keys — test first); Click service id.
11. Yandex Delivery contract/API token; BTS partner API docs and contract.
12. MoySklad account: price type name, warehouse, custom attribute names (IKPU, delivery method).

## Marketing
13. Canonical first-order code — use `SALOM10` (design also shows `FOREST10`)?
14. Max marketing messages per day: 1 (A12) or 2 (bot map)? Default 1.
15. Replay sampling rate & consent banner wording.
16. Ad accounts: Meta pixel/CAPI token, Google Ads (developer token, conversion actions), TikTok, Yandex Direct.
17. Real reviews: none yet → hide rating blocks until first verified reviews (no fake numbers).

## Domains & accounts
18. Domain (`forest.uz`?) and DNS access; Cloudflare account.
19. Telegram bot username/token, admin group; Eskiz account + approved SMS templates.
20. Brandbook PDF → add to `design/brandbook/`.
