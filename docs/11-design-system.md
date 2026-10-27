# 11 · Design system

Style: **QClay-deck editorial premium × Forest brandbook** — calm sage/forest palette, big confident type with tight tracking, white rounded panels on a warm light-grey canvas, pill buttons, real photography, minimal decoration. Premium = whitespace + restraint, not effects.

If the brandbook PDF is added at `design/brandbook/`, its logo rules and colors override this file.

## Tokens (put in `packages/ui/tokens.ts` → Tailwind v4 `@theme`)

### Color
| Token | Hex | Use |
|---|---|---|
| `forest` | `#334229` | brand primary, active states, switches on, accent text |
| `ink` | `#141712` | main text, primary dark buttons, dark sections |
| `canvas` | `#EEEFEA` | page background, input fill, chips |
| `panel` | `#FFFFFF` | cards/panels |
| `muted` | `#5E6459` | secondary text |
| `subtle` | `#8D9586` | tertiary text, placeholders, icons |
| `line` | `#DADDD3` | borders, table header rule |
| `line-soft` | `#EEEFEA` | row dividers |
| `sage` | `#D5DDC8` | avatars, soft highlight, badges on dark |
| `sage-50` | `#F1F5EC` | selected row, info callouts |
| `off` | `#F7F7F4` | quiet surfaces |
| `ink-2` | `#3F453B` | body text on light (long copy) |
| `dark-2` | `#23271F` / `#2E332A` | surfaces on dark (admin nav input, progress track) |
| `on-dark-muted` | `#C9CFC2` / `#A9B39E` | text on dark |
| status good | text `#1F6B35` on `#E8F2EA` (alt text `#1F5A30`) |
| status warn | text `#6B4E00` on `#FFF4D6` |
| status critical | text `#8A1C12` on `#FBEAE8`; strong red `#B42318` |
| live dot / success | `#3E8E4E` |
| telegram link (bot mocks) | `#2A6A9A`; bot bubbles out `#E1F3D0`, chat bg `#E4EADD` |
| chart categorical | `#3A7D44`, `#2F6DB5`, `#C9692C`, `#8E5BB5`, `#A3851F` (validated, colorblind-safe order) |

Dark mode: not required for storefront v1. Admin: optional later.

### Typography
- Font: **Montserrat** (400, 500, 600, 700) via `next/font/google`, `display: swap`, subsets latin + cyrillic (RU!).
- Scale (desktop → mobile):
  | Role | Size / weight / tracking |
  |---|---|
  | Display (hero) | 96 → 44 px · 500 · −0.05em · line-height 0.95 |
  | H1 page | 64–72 → 36 px · 500 · −0.045em |
  | H2 section | 48–52 → 30 px · 500 · −0.04em |
  | H3 | 30–36 → 24 px · 500/600 · −0.03em |
  | Admin page title | 36 px · 500 · −0.035em |
  | Card title | 18–22 px · 600 · −0.01/−0.02em |
  | Body L | 16–18 px · 400 · line-height 1.55 |
  | Body | 14–15 px · 400/500 |
  | Small / meta | 12–13 px · 500/600 |
  | Overline | 11–12 px · 600–700 · +0.08em · uppercase |
- Numbers in tables/KPIs: `font-variant-numeric: tabular-nums`.

### Radius
| Token | px | Use |
|---|---|---|
| `pill` | 999 | buttons, chips, badges, inputs (search) |
| `xl` | 40 | storefront hero/section panels |
| `lg` | 28–32 | cards/panels (admin panels 28) |
| `md` | 22–24 | KPI tiles, product cards |
| `sm` | 14–18 | images in cards, inputs (12–14), callouts |
| `xs` | 8–12 | thumbnails, code chips |

### Spacing & layout
- 4-px grid; panel padding 20–32 px desktop, 16–20 px mobile; section gap 16 px (admin) / 24–40 px (storefront).
- Storefront container max 1440, side gutter 16 px mobile / 24–40 px desktop.
- Admin: sidebar 248–264 px + fluid main, panels wrap (`flex-wrap`) → tablet friendly.
- Breakpoints: `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1440`.

### Elevation & motion
- No heavy shadows; separation by color (white on `canvas`). Optional `0 1px 2px rgb(20 23 18 / .06)` on floating elements (sticky bars, popups).
- Motion 150–250 ms ease-out; respect `prefers-reduced-motion`. Before/after slider and carousels must be touch-friendly.

## Components (build in `packages/ui`, Storybook optional)
Buttons (primary ink, brand forest, secondary outline `line`, ghost; sizes md 44 px / lg 52 px; pill), IconButton, Chip/FilterChip, Badge (Xit/Yangi/−10 %/status), Input (+998 phone mask), OTP input (4 cells), Select, Textarea, Switch (44×26, knob 20), Tabs/Segmented (pill group on white or canvas), Card/Panel, KPI tile, Data table (CSS grid rows — sticky header, row select, mobile cards), Pagination, Drawer/BottomSheet (mobile filters), Modal (popup), Toast, Tooltip, Progress (free-delivery bar, launch kit), Timeline (order status), Stepper (checkout), Rating stars, Before/after slider, Gallery/lightbox, Price (so'm format), Countdown/ETA line, Logo row (payment/delivery), Empty/Error state block, Skeletons, Avatar/initials, Lettermark tile (integrations), Charts (line/area/bar/funnel/heatmap/cohort — use one lib, e.g. Recharts or visx, styled with tokens).

## Copy & tone
- UZ Latin with correct apostrophes `o'`, `g'` (use ʻ/’ consistently — pick `'` U+0027 in code strings, typographic `ʻ` optional in content).
- Short, concrete, benefit-first; error messages never blame the user and always offer a next step (see `Holatlar`).
- Placeholders in `[brackets]` must never ship; CI check fails the build if `[` + placeholder words appear in rendered public pages.

## Fidelity checklist per screen
1. Compare implementation screenshot vs `design/screens/<Screen>.png` at 1440 and 390 widths (Playwright visual snapshot).
2. All interactive states from the `.dc.html` `state` exist (tabs, selection, toggles, steps, sheets).
3. Real data from API, no hardcoded sample data.
4. Lighthouse mobile ≥ 90, a11y ≥ 95.
