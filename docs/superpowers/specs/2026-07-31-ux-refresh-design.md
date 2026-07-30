# Decidarr v1.3 "Into the Swamp" — UX Refresh: Design Specification

**Date:** 2026-07-31
**Status:** Approved in brainstorming (visual companion session; all directions
chosen from rendered mockups); ready for implementation planning
**Prerequisite reading:** `docs/specs/2026-07-11-decidarr-v1-design.md`
(§ "UX & visual system" — this spec SUPERSEDES that section's palette and
extends its layout contract; every non-visual invariant there still stands).

## What it is

A visual and layout refresh in Swamp Roulette's spirit, chosen mockup-by-
mockup with the owner: a warm plum room replacing the cool ink, soft
elevation replacing flat surfaces, the Reel Roulette mark finally on stage,
filters promoted from a hidden sheet to an always-visible Console, and a
real desktop layout (Two-Pane Theater) instead of a centered phone column.
Frontend-only; no API, schema, game-logic, or copy-personality changes.

## Decisions (settled in brainstorming)

| Question | Decision |
|---|---|
| Palette direction | **Swamp & Gold hybrid** (option C of three rendered palettes): SR's warm plum room and ritual, Decidarr keeps gold as the primary action colour so existing brand assets still match. Ember (SR's red-orange) demoted to kickers/veto/duel heat; green stays players/success. |
| Button depth | **Soft Elevation** (option A of three rendered treatments): gradient + ambient shadow + inner top highlight; press sinks 1px into an inset shadow. Applied to ALL raised controls, scaled to prominence; ghost/link buttons stay flat. Not chunky press-key, not retro bevel. |
| Desktop layout | **Two-Pane Theater** (option B of three wireframes) at ≥960px: stage left, living rail right. Mobile (<960px) is UNCHANGED — same bottom nav, thumb-arc spin bar, current flows. |
| Logo placement | Combined (owner: "I like your instinct"): **hero emblem** on the spin view's idle hero (option B), **masthead lockup** in the desktop top bar (option A), **ambient watermark** behind the desktop rail (option C). |
| Filters | **The Console** (option B of three rendered treatments): filters permanently visible on the spin view — under Spin/Duel on mobile, top block of the rail on desktop. The header Filters button and the FiltersSheet bottom sheet RETIRE. |
| Runtime presets | **First-class buttons** in the Console: School Night / Committed / **Whatever** (new third, = any length), with their minute ranges printed on the buttons. Preset values come from the existing per-stream `PRESETS` in `store.ts` (movie 40–110 / 110–210; tv 15–35 / 35–90) — unchanged. Slider stays as fine-tuning below, two-way synced (preset tap snaps slider; slider drag un-highlights preset). |
| Display type | **Fraunces**, self-hosted via npm (`@fontsource/fraunces`; no CDN — PWA stays offline-safe), display moments ONLY: marquee wordmark, tonight/pick titles, duel "VS". Body stays Inter, labels/stats stay JetBrains Mono. |
| Version | **v1.3.0**. |

## 1. Palette & atmosphere (tokens.css)

Replace the cool base with the plum room; keep spacing/radius/motion tokens
as-is:

```css
--ink:   #1e1420;   /* was #10141a — plum-black room */
--panel: #2c1f30;   /* was #1a212b */
--line:  #443247;   /* was #2a3442 */
--gold:  #d4a943;   /* unchanged — primary action */
--gold-hi: #e3bc58; /* NEW — gradient top / active-text gold */
--gold-lo: #c99a33; /* NEW — gradient bottom */
--gold-edge: #8a6b1d; /* NEW — gold borders/edges */
--ember: #e0502f;   /* NEW — SR red-orange: fills, veto/duel heat */
--ember-text: #e8603f; /* NEW — ember at text size on plum (AA) */
--green: #4cb573;   /* was #3fae6a — warmed; players/success */
--cream: #efe6d8;   /* was #e8e0cc — warmed */
--dim:   #8d7c90;   /* was #7d8899 — plum-tinted */
```

- **Pinstripe atmosphere:** the app background (body) carries SR's texture:
  `repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 1px,
  transparent 1px 46px)` layered over `--ink`. Subtle by design.
- **Kickers go ember:** every mono uppercase kicker/section label that is
  currently gold (`TONIGHT`, hero kicker, section titles, sheet titles)
  switches to `--ember-text`. Gold now means "actionable", ember means
  "ritual heading", green means "people/success".
- Contrast: `--ember-text` on `--ink`/`--panel` must pass AA for its
  small-mono usage; `--cream` on `--ink` and `--ink`-text on gold already
  clear AA — verify all three during implementation with a contrast check.

## 2. Depth system (new tokens + application)

```css
--elev-1: 0 2px 8px rgba(0,0,0,0.35);                    /* chips, secondary */
--elev-2: 0 4px 14px rgba(0,0,0,0.45);                   /* primary buttons  */
--elev-card: 0 3px 12px rgba(0,0,0,0.35);                /* cards, sheets    */
--edge-hi: inset 0 1px 0 rgba(255,255,255,0.18);         /* top highlight    */
--edge-hi-soft: inset 0 1px 0 rgba(255,255,255,0.05);    /* card highlight   */
--press: inset 0 2px 6px rgba(0,0,0,0.35);               /* pressed/inset    */
```

- **Primary actions** (Spin, Let's Watch, Summon, duel-start): background
  `linear-gradient(180deg, var(--gold-hi), var(--gold-lo))`, shadow
  `var(--elev-2), var(--edge-hi)`; `:active` → `translateY(1px)` +
  `var(--press)`, gradient flattens to `--gold-lo`.
- **Secondary buttons & chips** (Duel, Veto, Seen it, settings buttons,
  filter chips): panel fill, `var(--elev-1)`; same press behaviour, gentler.
- **Cards & sheets** (tonight card, pick card, connection cards, console,
  rail cards, toasts): `var(--elev-card), var(--edge-hi-soft)`.
- Ghost/link buttons (`.btn-link`, nav items) stay flat. All transitions
  ≤ `--t-micro` (150ms); no reduced-motion concerns (opacity/shadow only).

## 3. Type (Fraunces display moments)

- Add `@fontsource/fraunces` (weights 600 + 600-italic, `latin` subset) to
  the frontend bundle; expose as `--font-display`.
- Used at exactly: (a) the **marquee wordmark** — "Deci" in cream +
  "darr" in gold italic (masthead + any centered wordmark moments);
  (b) **TonightCard and PickCard titles**; (c) the **duel "VS"**.
- Nowhere else. Body/UI stays `--font-body` (Inter); labels, stats, counts,
  kickers stay `--font-mono`.

## 4. The mark on stage (logo)

The source SVG (`assets/logo.svg`, "Reel Roulette") is re-tinted for the
plum room as an inline React component `ReelMark` (props: `size`,
`variant: "full" | "outline"`): reel body `--panel`, rim/hub/pointer gold,
lucky pocket `--green`, holes `--ink`, NO background circle. The files in
`assets/` and `frontend/public/` (PWA icons) are untouched.

1. **Hero emblem (all widths):** `ReelMark` (~72–98px, drop shadow) sits at
   the top of the idle hero, above the kicker. During the `spinning` phase
   the emblem replaces nothing — the poster shuffle stays — but on the
   idle→spinning transition the emblem spins up (CSS rotation) as it hands
   off; under `prefers-reduced-motion` it never rotates. It does not render
   on `landed` (the pick keeps the spotlight) or in the slim ready-line
   variant.
2. **Masthead lockup (desktop only):** `ReelMark` at ~30px + the Fraunces
   wordmark, left end of the top bar.
3. **Ambient watermark (desktop only):** `variant="outline"` (single-colour
   cream silhouette), ~380px, `opacity: 0.05`, absolutely positioned behind
   the rail, `pointer-events: none`, `aria-hidden`.

## 5. The Console (filters in the open)

A new `Console` component replaces the FiltersSheet + header Filters button
on the spin view. Same state, new presentation — `useSession` filters,
`PRESETS`, and `eligibleItems` are untouched.

- **Contents, top to bottom:** label "How long have we got?" (new string) →
  preset row (**School Night / Committed / Whatever**, ranges printed as
  sublabels, active preset gold-highlighted) → runtime dual-slider
  (fine-tuning; reuses existing `.range-dual`) → Decade chip row (replaces
  the decade `<select>`; includes "Any") → Genre chip row (union of pool
  genres, as today; two rows show by default with the rest behind a "+N"
  chip that expands the row inline, flipping to "less") → bottom row:
  Include-seen toggle chip · Blind-mode toggle chip · ember Reset chip.
- **Preset↔slider sync:** preset tap sets the runtime range to its values;
  a preset renders active iff the current range equals its values exactly
  ("Whatever" ≡ unbounded). Any other range → no active preset. Pure
  helper in `logic.ts` (`activePreset(filters, stream)`) so this is
  vitest-tested.
- **Placement:** mobile — directly under the Spin/Duel bar; the page
  scrolls to reach the console's lower rows, and Spin's at-rest thumb-arc
  position is unchanged. Desktop — top card of the rail.
- **Retirements:** `FiltersSheet.tsx` deleted; the header's Filters button
  and `filtersOpen` state deleted; the header keeps player pill + stream
  toggle (+ gains nothing on mobile). The "Filters · N" badge count moves
  to the Console header label as a subtle "· N active" suffix when > 0.
- Blind mode and include-seen semantics unchanged.

## 6. Two-Pane Theater (desktop ≥960px)

- **Breakpoint:** 960px, via a `useIsDesktop()` matchMedia hook (SSR-safe
  guard, listener cleanup). Below it: the app EXACTLY as today (bottom nav,
  header, single column). The existing 560px max-width bump (520px column)
  stays for the in-between sizes.
- **Top bar (replaces header + bottom nav):** masthead lockup left ·
  player pill + Movies/TV toggle center · mono nav right
  (SPIN · HISTORY · BOARD · ⚙), active item gold on gold-tint pill.
- **Spin view:** CSS grid `1.65fr 1fr`, gap `--s5`, max-width 1200px
  centered. Left: the stage panel (its own soft-elevated surface) — hero
  emblem, kicker, invitation, count, then Spin + Duel side by side
  (~2.6:1). Right rail, in order: **Console → TonightCard → HistoryRail →
  BoardStrip**, all `--elev-card` cards, watermark behind.
- **HistoryRail / BoardStrip:** compact variants derived from the existing
  Views internals (extract the row-rendering pieces rather than duplicate):
  HistoryRail = latest ~6 history rows (green player names, mono
  timestamps) + top grudges (ember GRUDGE tag); BoardStrip = per-player
  watched counts plus the current Duel Champion chip (omitted when nobody
  holds it — never a 0-0 crown, matching the flavor-title rules). Both read the already-fetched
  `/api/state` — zero new API calls. Full History/Board views remain for
  the nav.
- **TonightCard placement:** on desktop it renders in the rail (not above
  the stage); mobile keeps today's above-stage placement. One component,
  two mount points chosen by `useIsDesktop()` in App.
- History / Board / Settings views on desktop: single centered column,
  max-width ~760px — comfortable, no redesign.

## 7. What does NOT change

Game logic and API contracts; strings personality (new strings additions:
console labels, "Whatever" preset, "· N active"); spin-theater timing and
`prefers-reduced-motion` behaviour (invariant #9); Lucide-only iconography
(the ReelMark is brand, not UI iconography — invariant #10 stands); brand
asset files and PWA icons; admin gating; accessibility affordances (44px
touch targets, focus-visible rings — now gold on plum; aria-live regions).

## Testing

- Vitest: `activePreset` helper (each preset, exact-match rule, Whatever,
  custom range → none, per-stream values); existing suites stay green
  (Header/FiltersSheet removals may delete/adjust a small number of tests).
- Build (tsc) green; bundle check that Fraunces adds only the two subsetted
  weights.
- Browser smoke at **390px and 1280px**: palette/pinstripes render; hero
  emblem shows idle and is absent on landed; console presets sync with the
  slider both directions; desktop top bar navigates all four views; rail
  shows Console/Tonight/History/Board with live data; watermark behind rail;
  mobile bottom nav + sheet-free filter flow works one-handed.
- Contrast spot-check (ember-text, cream, gold-on-ink) during
  implementation.

## Release

**v1.3.0** through the standard pipeline (suites → merge → tag → CI →
Docker Hub → owner redeploys via Dockhand). Mockups that drove the
decisions persist in `.superpowers/brainstorm/3665-1785445552/content/`
(gitignored scratch — this spec is the authoritative record).
