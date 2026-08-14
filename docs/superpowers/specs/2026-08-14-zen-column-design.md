# Decidarr v1.6 — Zen Column: Design Specification

**Date:** 2026-08-14
**Status:** Approved in brainstorming (simplification mockup C chosen: "Lets
try zen mode"); ready for implementation planning
**Prerequisite reading:**
`docs/superpowers/specs/2026-07-31-desktop-stage-rebalance-design.md` (v1.5,
whose two-pane rail this retires) and
`2026-07-31-ux-refresh-design.md` (v1.3, the theater's origin).

## What it is

v1.5 shipped and the owner's verdict was "WAY too much going on": the
permanent Console, dense rail, and the pick+respin stack competed for
attention. The Zen Column is the diet: on desktop the spin view becomes
**one centered column** — the stage, then a **single slim control strip**
(list · length · filters · count · Spin · Duel). The rail retires; History
and Board go back to being tabs only; everything rarely touched folds into
a filters sheet. It also fixes the double-poster stack: spinning with a
committed pick **swaps** the stage to the spin theater (with a "Replacing
{title}?" chip) instead of piling a second card beneath it.

Mobile is untouched, again: below 960px the app keeps its v1.4 shape
(header, tonight card, hero, spin bar, inline Console, bottom nav).

## Decisions (settled in brainstorming)

| Question | Decision |
|---|---|
| Direction | **C, "Zen Column"** — chosen over A ("Quiet Console": keep layout, collapse filters) and B ("Two Modes": hide all controls once picked). |
| The rail | **Retired from the spin view.** `HistoryRail`, `BoardStrip`, and the rail watermark are DELETED (their only consumer was the rail); the full History and Board views remain in the nav. The `theater` grid CSS goes with them. |
| The Console on desktop | Its content moves into a **filters sheet** opened from the strip's "Filters · N" button — the existing `Console` component rendered inside the existing `.sheet` chrome (overlay, slide-up). One component, two homes: inline on mobile, sheet on desktop. |
| The strip | One row under the stage, desktop only: **[list select] [length select] [Filters · N] [count] [Spin] [Duel]**. List = the v1.4 switcher compacted. Length = a select of School Night / Committed / Whatever (the preset buttons live on in the sheet and on mobile; the strip needs the skinny form). Count = the hero count / ready line. |
| Spin with a pick | The tonight stage renders only in the Stage's **idle** phase. Pressing Spin swaps the stage to the shuffle theater with a small ember chip — `Replacing {title}?` — above it; landing shows the PickCard as usual (its existing replace/409 flow already handles commit-over-pending). Veto/Seen-it respins keep the chip; committing installs the new pick; returning to idle restores the tonight stage. |
| Column width | max ~680px, centered; the stage panel and strip share it. |
| Watermark / fan / emblem | The poster fan and corner emblem (v1.5) SURVIVE — they live inside the stage and are the right kind of quiet. The rail watermark dies with the rail. |
| Version | **v1.6.0**. |

## Architecture

- **`Stage` absorbs the desktop pick.** New props `pick: CurrentPick | null`
  and `pickPoolItem: PoolItem | null` (desktop only; mobile passes null and
  keeps its above-stage TonightCard). In the idle phase with a pick, Stage
  renders `<TonightCard variant="stage" .../>` in the viewport instead of
  the hero; other phases render the theater as today, plus the
  `Replacing {title}?` chip when a pick exists. The v1.5 `+ .stage` footer
  CSS retires (the strip replaces the respin footer).
- **`ZenStrip`** (new, rendered by Stage under the viewport at ≥960px in
  place of the spin bar; the mobile spin bar is unchanged): pool select
  (reusing the switcher's activatePool/withAdminPin logic — move that
  logic to a small shared hook `usePoolSwitcher()` so Console and strip
  share it), length select driven by `activePreset`/`PRESETS` (choosing
  applies the range; a hand-tuned range shows "Custom"), a Filters button
  with the `· N active` badge opening the sheet, the count line
  (`heroCountLine`/`heroReadyLine` as appropriate), and the Spin + Duel
  buttons wired to the same handlers as the mobile bar.
- **Filters sheet (desktop):** local `sheetOpen` state in App's spin view;
  renders the existing sheet overlay containing `<Console pool={...}
  inSheet />` — Console gains an `inSheet` boolean that only suppresses its
  own card chrome (the sheet provides it) and hides the "Watching from"
  switcher row (the strip owns list switching on desktop).
- **App (desktop spin view):** `.zen` column replaces the `.theater` grid —
  `<Stage pick={currentPick} pickPoolItem={...} ... />` and the sheet
  mount. `HistoryRail`/`BoardStrip` deleted from Views.tsx; rail CSS
  pruned.
- Copy: strip strings (`S.pools.watchingFrom` reused as aria-label;
  `S.filters.title` for the button; new `S.filters.console.custom:
  "Custom"` for the hand-tuned length state; `S.watch.replacing(title)`
  for the chip).

## What does NOT change

Mobile, entirely (inline Console, spin bar, tonight card, bottom nav, no
strip, no sheet). The spin/veto/replace/duel contracts and theater timing.
TonightCard's variants and actions. The History/Board full views. All
v1.5 helpers (`fanPosters`, `heroCountLine`, `heroReadyLine`,
`activePreset`) — reused, not changed.

## Testing

- Vitest: existing suites stay green; no new pure logic beyond what's
  already tested (the strip composes tested helpers). A small test for the
  length-select mapping (preset key ↔ applied range incl. "Custom"
  display) if extracted as a helper.
- Browser smoke at 1280px: no pick → single column, stage hero + fan,
  strip with list/length/Filters/count/Spin; Filters opens the sheet with
  the full Console (minus switcher row); length select snaps the range;
  spin lands a pick; commit → tonight stage in the column; Spin again →
  theater swaps in with "Replacing …?" chip, landing + replace works; no
  rail anywhere. At 390px: identical to v1.5 mobile.
- Suites + build green throughout.

## Release

**v1.6.0** through the standard pipeline; owner redeploys via Dockhand.
