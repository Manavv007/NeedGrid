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
