# NeedGrid design tokens

Owner: C (frontend). B: use these for the AG Studio dashboard theme so it matches the rest of the app.
Source of truth in code: `apps/web/src/styles/globals.css` (CSS variables + Tailwind theme).

## Feel

Warm, trustworthy, concrete. Real product photos are the hero; the UI stays calm around them.
"Community noticeboard meets a good e-commerce card", not a fintech dashboard.

## Core colours (from the plan)

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#FBF8F3` | Page background (public pages) |
| `--surface` | `#FFFFFF` | Cards, panels |
| `--text` | `#1F2328` | Body text |
| `--muted` | `#6B6F76` | Secondary text (4.9:1 on `--bg`, passes AA) |
| `--primary` | `#0F766E` | Buttons, progress fill, links |
| `--accent` | `#EA7A2E` | Urgency 3 fills and icons only (not text, see below) |
| `--success` | `#15803D` | Funded, delivered |
| `--warning` | `#B45309` | Needs review, price went up |
| `--held` | `#99D5CF` | Held segment of the progress bar (striped) |

## Added during design (keep these)

| Token | Hex | Why |
|---|---|---|
| `--left-text` | `#C2410C` | "$14 left" text. `#EA7A2E` text on white is about 3:1 and fails AA; this passes (5.2:1) |
| `--danger` | `#B91C1C` | Errors, failed approvals, wrong passcode |
| `--staff-header` | `#134E4A` | Staff screens header, so staff always know they're in the admin side |
| `--staff-bg` | `#F6F4EF` | Staff page background |
| `--border` | `#ECE6DC` | Card borders (public) |
| `--border-strong` | `#D9D3C7` | Inputs, secondary buttons |
| `--track` | `#EFEAE1` | Empty part of progress bars, skeletons |
| `--placeholder` | `#F4F1EB` | Image placeholder |
| `--held-stripe` | `#C5E8E4` | Second stripe colour for the held segment |
| `--paypal-mock` | `#FFC439` | Mock PayPal button only (real buttons come from the PayPal SDK) |

## Added in C-1 (colours the approved screens use that weren't named yet)

| Token | Hex | Use |
|---|---|---|
| `--text-soft` | `#4A4F57` | Explainer paragraphs (hero, empty/error messages) |
| `--primary-hover` | `#115E59` | Hover on primary buttons and links |
| `--primary-soft` | `#E6F4F2` | "How it works" step circles, open-status badge |
| `--on-primary` | `#FFFFFF` | Text on primary / staff header |
| `--staff-header-link` | `#D5ECE9` | Inactive links in the staff header |
| `--placeholder-strong` | `#E9E4DA` | Arrival-photo placeholder |
| `--placeholder-icon` | `#8A8F96` | Icon inside image placeholders (decorative) |

## Added in C-3 (need page, donate panel, thank-you)

| Token | Hex | Use |
|---|---|---|
| `--success-soft` | `#F0FDF4` | "Fully funded, thank you!" box background |
| `--success-border` | `#BBF7D0` | Border of that box |
| `--success-strong` | `#14532D` | Its heading (body text uses `--badge-success-text`) |
| `--quote-bg` | `#F0F8F7` | Staff arrival message, "the rest went to the next need" explainer |
| `--quote-text` | `#134E4A` | Text on `--quote-bg` |
| `--confirming-track` | `#FDE68A` | Track of the "Confirming your gift…" spinner (the moving part is `--warning`) |

## Added in C-5 (live updates, big screen)

| Token | Hex | Use |
|---|---|---|
| `--reconnecting-dot` | `#FBBF24` | Dot in the "Reconnecting live updates…" pill (the pill itself is `--text` with white text) |

- Just-funded highlight: `animate-just-funded` (two soft rings of `--success` spreading out), with a `--success` border.
- Big-screen ticker: `--staff-header` background, "Just now" pill in `--success`.
- Big-screen mode scales every rem with the screen (`html[data-display="wall"]` in `globals.css`): 16 px at 1920×1080.

## Added in C-7 (purchase plan)

| Token | Hex | Use |
|---|---|---|
| `--warning-soft` | `#FFFBEB` | Background of the "Price now" box when the price went up (border `--warning`, text `--badge-warning-text`) |

- Cheaper price: `--success` border on `--success-soft`, text `--badge-success-text`. Same price: the normal card border.
- A locked step ("Unlocks after approval") has a dashed `--border-strong` border. Its text keeps full contrast; only the
  disabled controls are dimmed.

## Used in C-8 (delivery, impact page): no new tokens

- "Needs your review before donors see it" header: `--badge-warning-bg` with `--badge-warning-text` (heading and icon).
- Photo match meter: `--track` behind; fill `--success` at or above `DELIVERY_MATCH_THRESHOLD`, `--warning` below. The
  text next to it ("94% match", "58% match · check it") always says it too, with an icon.
- "The automatic check didn't run" box: `--warning` border on `--warning-soft`, text `--badge-warning-text`.
- Impact page: arrival message box `--quote-bg` / `--quote-text`; the "Save your impact link" box there is the quiet
  variant, a dashed `--held` border (the thank-you page keeps the 2 px `--primary` one).

## Used in C-9 (assistant, approval cards, money check): no new tokens

- Approval card "Needs your approval": 2 px `--warning` border, header `--badge-warning-bg` / `--badge-warning-text`.
  Executed: `--success` border, `--badge-success-*` header. Failed: `--danger` border, `--badge-danger-*` header.
  Still running ("Approved, working…"): `--badge-info-text` border, `--badge-info-*` header. Rejected: the normal card
  border, title in `--text-soft`. Every state says it in words with an icon, never colour alone.
- "Created by NeedGrid" tag (actions the server proposed itself): `--surface` at 80% on the header, `--text-soft` text.
- Chat: staff bubbles `--primary` with `--on-primary` text, assistant bubbles `--staff-bg`, error bubbles
  `--badge-danger-bg` / `--badge-danger-text`, tool status lines `--muted` with a `--held` / `--primary` spinner and a
  `--success` check.
- Money check banner: `--success` ("Everything matches") or `--danger` ("N things don't match") with white text.
- Printing the invoice QR dialog puts only that dialog on paper (`data-print="sheet"`, `@media print` in
  `globals.css`): QR code, recipient and amount, `--text` on `--surface`.

## Used in C-10 (invoices, Match me, QR flyers): no new tokens

- Sponsor invoice status badges, always text + icon: Draft `--badge-low-*` (neutral), Sent `--badge-info-*`, Paid
  `--badge-success-*`, Cancelled muted (`--surface` with a `--border-strong` outline and `--text-soft` text).
- Match me box: `--staff-header` background, `--on-primary` heading, `--staff-header-link` labels and helper text,
  white (`--surface`) inputs and "Find matches" button with `--staff-header` text. Focus rings are white on the dark box.
  Inline errors are `--badge-danger-bg` / `--badge-danger-text` pills; "Too many tries" uses `--badge-warning-*`; the
  "AI is resting" note uses `--badge-info-*`. Result cards: reason under "AI suggestion" on `--quote-bg` / `--quote-text`.
- QR flyers on screen: a `--surface` sheet on `--placeholder`, tile borders `--text`, "left" amounts `--left-text`.
  Printed (`[data-flyer-sheet]` in `globals.css`): black on white, progress bars outlined, nothing that needs a
  background colour to be understood. The toolbar sets `@page` to A4 or Letter with 12 mm margins.

## Added in C-11 (product-photo placeholders)

Items without a product photo (food is hand-written, `manual-` products, and has no Channel3 image) show a placeholder
tinted for the need's category: a category icon and, on larger photos, the category name under it
(`components/ProductPhoto.tsx`). Compact thumbnails (staff table, Match me, impact cards, flyer list, next-need card,
purchase cards, intake options) show only the tinted icon. The text colour is used for the icon and the name; every
pair passes AA for small text. `role="img"`, `aria-label` "No photo for Canned tuna (Food)".

| Category | Label | Icon (lucide) | Background | Text / icon | Contrast |
|---|---|---|---|---|---|
| `food` | Food | `Apple` | `--category-food-bg` `#FDF0E1` | `--category-food-text` `#8A4510` | 6.4:1 |
| `hygiene` | Hygiene | `Droplets` | `--category-hygiene-bg` `#E3F3F6` | `--category-hygiene-text` `#1C5E6E` | 6.4:1 |
| `baby` | Baby | `Baby` | `--category-baby-bg` `#FCEAF0` | `--category-baby-text` `#8C3256` | 6.7:1 |
| `clothing` | Clothing | `Shirt` | `--category-clothing-bg` `#EAEDFB` | `--category-clothing-text` `#3B478C` | 7.3:1 |
| `bedding` | Bedding | `BedDouble` | `--category-bedding-bg` `#EFEAF8` | `--category-bedding-text` `#5A3D85` | 7.3:1 |
| `school` | School supplies | `Backpack` | `--category-school-bg` `#FAF3D7` | `--category-school-text` `#6E540A` | 6.4:1 |
| `pet` | Pet supplies | `PawPrint` | `--category-pet-bg` `#F4ECE2` | `--category-pet-text` `#6B4728` | 7.0:1 |
| `medical` | Medical | `Pill` | `--category-medical-bg` `#E6F0FA` | `--category-medical-text` `#1F4F80` | 7.3:1 |
| `household` | Household | `House` | `--category-household-bg` `#E7F3EA` | `--category-household-text` `#2D6140` | 6.4:1 |
| `other` | Other | `Package` | `--category-other-bg` `#F1EFEA` | `--category-other-text` `#4A4F57` | 7.2:1 |

Tailwind: `bg-category-food-bg text-category-food-text`, and so on. Printed flyers drop the tint (black on white).

- "Not switched on yet" notice (a staff list whose server route doesn't exist yet, `ErrorState tone="notice"`): a
  `--badge-low-bg` / `--badge-low-text` clock icon instead of the red alert icon, `role="status"`.

## Used in C-13 (public site header and footer): no new tokens

- Header: sticky, `--surface` at 95% with a light backdrop blur, `--border` bottom border, 64 px tall. Nav links
  `--text-soft`, hover `--text`; the current page (`aria-current="page"`) is `--text` and bold, so it never relies on
  colour alone. "Give an item" is the primary button. Phone menu panel: `--surface`, 48 px links, the current page on
  `--primary-soft` with `--primary` text. `theme-color` in `index.html` is `--primary` (`#0F766E`).
- Landing sections the header links to (`#orgs`, `#how-it-works`, `#match`) and `#main` have `scroll-mt-16`, so the
  sticky header doesn't cover them; the need page's sticky donate column sits at `top-22` for the same reason.
- Footer: `--surface` with a `--border` top border; column headings `--text`, links `--text-soft`, small print `--muted`.

## Status badges (background / text)

| Status | Background | Text | CSS variables |
|---|---|---|---|
| Urgent (3) | `#FDEBDD` | `#9A3412` | `--badge-urgent-bg` / `--badge-urgent-text` |
| Medium (2) | `#FEF3C7` | `#92400E` | `--badge-medium-*` |
| Low (1) | `#EEF2F1` | `#3F5450` | `--badge-low-*` |
| Funded / Delivered | `#DCFCE7` | `#166534` | `--badge-success-*` |
| Ordered / Sent | `#E0F2FE` | `#075985` | `--badge-info-*` |
| Topping up / Needs review | `#FEF3C7` | `#92400E` | `--badge-warning-*` |
| Error / Failed | `#FEE2E2` | `#991B1B` | `--badge-danger-*` |

Urgency is never colour alone: always text + icon.

## Using the tokens in code

- `apps/web/src/styles/globals.css` defines every token above as a CSS variable on `:root`, and maps each one to a
  Tailwind colour in `@theme`: `bg-surface`, `text-soft`, `text-left-text`, `bg-track`, `bg-held`, `bg-staff-header`,
  `border-border-strong`, `bg-badge-urgent-bg text-badge-urgent-text`, … The orange accent is `bg-brand-accent`.
- shadcn/ui's own names are mapped onto ours: `background` → `--bg`, `foreground` → `--text`, `muted-foreground` →
  `--muted`, `primary` → `--primary`, `border` → `--border`, `input` → `--border-strong`, `ring` → `--primary`,
  `destructive` → `--danger`. shadcn's `muted` and `accent` mean *surfaces*, so in Tailwind they point at `--track`
  and `--placeholder`; our `--muted` (grey text) and `--accent` (orange) keep their meaning as CSS variables.
- Held stripes: the `bg-held-stripes` utility (45° stripes of `--held` and `--held-stripe`).
- Light theme only.

## Type

- Font: Inter (400, 500, 600, 700, 800), system stack fallback. Self-hosted (`@fontsource-variable/inter`), so there is
  no third-party font request.
- Money: `font-variant-numeric: tabular-nums` everywhere (set on `body`; Tailwind's `tabular-nums` utility also exists).
- Page title 28–40 px / 800 / letter-spacing -0.03em. Card title 16 px / 700. Body 15–16 px / 400. Small 12–13 px.

## Shape and spacing

- Radius: 12 px cards (`rounded-xl`), 8 px controls (`rounded-md`), 999 px pills (`rounded-full`).
- Tap targets: at least 44 px.
- Progress bar heights: 8 px (phone list), 10 px (tile), 12 px (donate panel), 16 px (big screen).
- Grid: 1 column at 360 px, 2 at 640, 3 at 1024, 4 at 1440.

## Money display

- Always `formatUsd(cents)`. Never more than 2 decimals; whole dollars shown without ".00" on tiles, with ".00" in the donate panel and receipts.
- "Left" amounts bold in `--left-text`.
- Progress shows funded + a striped held segment.

## Logo

Four rounded squares in a 2×2 grid inside a teal rounded square: white, light teal, light teal, white. Favicon at 32 and 16 px.

Designs: NeedGrid Screens canvas (ask C for the link).
