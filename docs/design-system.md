# PharmaPong Design System

> "Laborabend trifft Sportevent": a dark midnight-lab canvas with vivid reagent colours, condensed
> scoreboard typography and big, unmistakable controls for a loud, crowded party room.

Generated with the **ui-ux-pro-max** plugin (v2.13.0) and adapted for the event. Process:

1. `--design-system "sports tournament dashboard dark vibrant playful" --variance 6 --motion 4 --density 6`
   → persisted raw output in `design-system/pharmapong/MASTER.md` (style **Vibrant & Block-based**,
   pairing **Bebas Neue / Source Sans 3**, red/gold light palette).
2. Supplementary domain searches (all results reviewed, see table below): `color` (dark neon gaming
   esports; science laboratory biotech), `typography` (sports scoreboard condensed; playful modern
   rounded), `style` (dark mode oled vibrant), `ux` (touch target size spacing; destructive action
   confirmation; reduced motion animation; color not only indicator status; horizontal scroll mobile
   table), `product` (live real-time dashboard), `--stack shadcn` and `--stack nextjs`.
3. **Deviations from MASTER.md** (deliberate): the spec requires a _dark theme with vivid accents_, so the
   light red palette was replaced by the dark "Arcade/Gaming" palette family (search result _Arcade &
   Retro Game_: neon on `#0F172A`) blended with the _Biotech / Life Sciences_ cyan + green. Bebas Neue
   was replaced by the _Sports/Fitness_ pairing **Barlow Condensed + Barlow**, which has real weights
   and lowercase letters for German text with umlauts.

Implementation: tokens in `src/app/globals.css`, components in `src/components/pp/*` and
`src/components/ui/*` (shadcn, `base-nova` style on Base UI). Live preview at **`/styleguide`**.

## Recommendations for the 7 requested topics

| #   | Topic                                    | Recommendation (source)                                                                                                            | Applied as                                                                                                   |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | Mobile-first sports tournament dashboard | Product _live real-time dashboard_ → Dark Mode (OLED) + status indicator colours; style _Vibrant & Block-based_                    | Card blocks on midnight background; one primary card per section; bottom navigation ≤ 5 items                |
| 2   | Playful but professional branding        | Pairing _Sports/Fitness_ (Barlow Condensed/Barlow); _Arcade_ palette notes "neon on dark + score green"                            | Erlenmeyer-flask + ping-pong-ball logo, cyan/magenta "reagent" gradient, lab puns in copy, no emoji as icons |
| 3   | Accessible, highly legible UI            | ux _Color Only_: icons/text + colour; _Line height_ 1.5–1.75; dark-mode text ≥ 4.5:1                                               | `StatusPill` always icon + label; body 16px/1.5; muted text 8.4:1                                            |
| 4   | Dark theme with vivid accents            | style _Dark Mode (OLED)_: deep backgrounds, vibrant neon accents, minimal glow, text contrast 7:1+                                 | `--background #0A0F1C`, accents cyan/lime/magenta/amber, no pure white surfaces                              |
| 5   | Interactive knockout bracket             | ux _Table Handling_: horizontal scroll wrapper or cards on mobile; _Horizontal Scroll_: page itself must never scroll horizontally | Bracket in its own `overflow-x-auto` scroller with snap points; page width never exceeds viewport            |
| 6   | Large referee controls                   | ux _Touch Target Size_ (48dp Android / 44pt iOS) and _Touch Spacing_ (≥ 8px); _Confirmation Dialogs_ for irreversible actions      | Buttons default 48px, `xl` 80px; winner cards ≥ 96px; two-step review + `HoldToConfirm`                      |
| 7   | Public large-screen display              | ux _Excessive Motion_ (animate 1–2 key elements per view), _Reduced Motion_                                                        | 16:9 layout, timer 160px, team names ≥ 48px, only announcement animations, rotation never hides live matches |

## Colour tokens

All colours are semantic CSS variables (OKLCH), mapped into Tailwind via `@theme inline`.
Components never use raw hex values.

| Token              | Value (≈ hex)     | Use                                       | Contrast                           |
| ------------------ | ----------------- | ----------------------------------------- | ---------------------------------- |
| `background`       | `#0A0F1C`         | page                                      | –                                  |
| `card`             | `#131A2B`         | surfaces                                  | –                                  |
| `muted`            | `#1E2638`         | inputs, inactive tiles                    | –                                  |
| `foreground`       | `#F1F5FB`         | text                                      | 17:1 on background                 |
| `muted-foreground` | `#A9B4C8`         | secondary text                            | 8.4:1 on background, 7.4:1 on card |
| `primary`          | `#22D3EE` cyan    | primary actions, focus ring, table badges | dark ink on cyan 10:1              |
| `accent` / `live`  | `#A3E635` lime    | "läuft" (running reaction), secondary CTA | dark ink 11:1                      |
| `team-home`        | cyan              | team A side                               | always with label/name             |
| `team-away`        | `#F472B6` magenta | team B side                               | always with label/name             |
| `success`          | `#34D399`         | completed, confirm                        | dark ink 9:1                       |
| `warning`          | `#FBBF24`         | awaiting confirmation, last minute        | dark ink 10:1                      |
| `destructive`      | `#F43F5E`         | overtime, forfait, destructive actions    | white text 4.6:1                   |
| `gold`             | `#FACC15`         | champion, winner trophy                   | dark ink 11:1                      |

Match status colours (`status-*`) are **always** combined with an icon and German label (`StatusPill`):
Offen (dashed circle) · Bereit (clock) · Tisch zugewiesen (pin) · Läuft (pulsing dot) · Wartet auf
Bestätigung (hourglass) · Beendet (check) · Abgesagt (ban, struck through) · Forfait (flag).

## Typography

| Role                              | Font                                      | Size / weight                      |
| --------------------------------- | ----------------------------------------- | ---------------------------------- |
| Display (scores, timer, headings) | Barlow Condensed, uppercase, +2% tracking | 700–800                            |
| Body                              | Barlow                                    | 16px / 1.5, 400–600                |
| Numbers                           | `tabular` utility (tabular figures)       | timers and cup counts never jitter |

Scale (mobile → desktop): Display 48–72 · H1 36–48 · H2 24–30 · body 16 · small 14 · min 12 (labels only).
Public display: team names ≥ 48px, timer 160px, readable from > 5 m.

## Spacing, radius, elevation

- 4px base grid (Tailwind spacing); section gaps 24–40px, card padding 16px, gutter 16px.
- Radius: `--radius` 14px; cards `rounded-2xl`, buttons `rounded-xl`, pills `rounded-full`.
- Elevation through borders and tints rather than shadows. A live match gets a lime 1px outline glow.

## Buttons & interaction states

| Size      | Height   | Use                                        |
| --------- | -------- | ------------------------------------------ |
| `sm`      | 40px     | dense admin tables (desktop)               |
| `default` | **48px** | everything else                            |
| `lg`      | 56px     | primary page action                        |
| `xl`      | 80px     | referee: "Spiel starten", winner selection |
| `icon`    | 48×48    | icon buttons always have `aria-label`      |

Variants: `default` (cyan), `accent` (lime), `success`, `warning`, `destructive` (tinted),
`destructive-solid`, `outline`, `ghost`, `link`.
States: hover = 85% fill; focus = 2px cyan outline + offset (never removed); active = 1px press;
disabled = 50% opacity + `cursor-not-allowed`; loading = spinner + label change ("Wird gespeichert …").

**Destructive / final actions** use `HoldToConfirm` (1.2s press-and-hold with progress fill, keyboard:
hold Space/Enter) or a dialog that asks for typed confirmation (admin recovery: `QF1 ZURÜCKSETZEN`).

## Core components (`src/components/pp`)

| Component                            | Purpose                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `Logo`, `LogoMark`                   | Flask + ball + molecule mark, wordmark "Pharma**Pong**"                         |
| `TeamAvatar`                         | Logo or initials tile; side ring cyan (A) / magenta (B)                         |
| `StatusPill`                         | Icon + text + colour for match status                                           |
| `TableBadge`                         | "TISCH 1" in 4 sizes, up to 60px for the display                                |
| `BigTimer`                           | Server-synchronised countdown, warning < 60s, overtime banner "Zeit abgelaufen" |
| `MatchCard`                          | Code, table, status, both teams, cups, winner trophy, placeholders "Sieger QF1" |
| `HoldToConfirm`                      | Accident-proof confirmation                                                     |
| `ConnectionBadge`                    | Live / Verbinde neu … / Offline                                                 |
| `PageTitle`, `Section`, `EmptyState` | Page scaffolding                                                                |

## Responsive behaviour

- Mobile-first; breakpoints `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280; tested at 375, 768, 1440, 1920×1080.
- Narrow screens: cards instead of tables (standings use a compact 5-column grid with the team name
  truncating); the bracket scrolls horizontally inside its own container.
- Bottom tab bar on mobile (≤ 5 items, safe-area padding), top bar on desktop.
- `/display` is a fixed 16:9 grid scaled with `clamp()` and viewport units.

## Motion

- Tokens: fast 120ms (press), base 200ms (colour/hover), slow 420ms (announcements, `pop-in`).
- Animations only for: new match announcement, semifinal/final advancement, champion (gold glow + bubbles).
- `prefers-reduced-motion: reduce` disables all animation and transition durations globally (`globals.css`).

## Accessibility principles

1. Text contrast ≥ 4.5:1 (most pairs ≥ 7:1); meaningful icons ≥ 3:1.
2. Never colour alone: status = icon + text; teams = name + side label; winners = trophy icon + "Sieger".
3. Touch targets ≥ 48×48px with ≥ 8px spacing.
4. Visible focus everywhere; logical DOM order; `lang="de-CH"`.
5. Forms: visible labels, inline errors under the field, `autocomplete` attributes, paste allowed.
6. Live regions: connection state `role=status`; timers `role=timer` (not announced every second).
7. One primary action per screen; destructive actions require hold or typed confirmation.
