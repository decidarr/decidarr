# Decidarr v1.5 — Desktop Stage Rebalance: Design Specification

**Date:** 2026-07-31
**Status:** Approved in brainstorming (combined mockup A+C accepted); ready
for implementation planning
**Prerequisite reading:**
`docs/superpowers/specs/2026-07-31-ux-refresh-design.md` (§6, the Two-Pane
Theater this rebalances).

## What it is

The desktop theater's left pane read as a void — worst with a committed
pick, when the stage showed one grey line while the night's actual film hid
at the bottom of a dense rail. Two changes, desktop-only (≥960px; mobile is
untouched):

1. **Tonight takes the stage** (mockup A): a committed pick renders big in
   the left pane — poster, serif title, actions — with the wheel demoted to
   a respin footer beneath it.
2. **The poster fan** (mockup C): with no pick, the hero is backed by a
   handful of dimmed, tilted posters drawn from the eligible pool, and the
   emblem shrinks to a corner mark so the two don't fight.

## Decisions (settled in brainstorming)

| Question | Decision |
|---|---|
| Which cure | **A + C combined** — chosen over B ("Console joins the stage", rejected: keeps Tonight small) and over any single option. |
| Pick placement (desktop) | The Tonight content moves INTO the stage pane, top; it leaves the rail entirely. Rail order becomes **Console → History & Grudges → Board**. |
| Wheel with a pick | The existing Stage (slim ready-line + Spin/Duel) renders beneath the Tonight stage as a **respin footer** — divider above it, compact spacing. Spin/veto/replace flows unchanged: this is mobile's DOM order (Tonight above Stage), restyled. |
| Fan contents | Up to **4 posters**, sampled at random from the CURRENT eligible items that actually have poster art, re-sampled per mount ("a fresh handful each visit"). Dimmed (~0.3–0.45 opacity), tilted (−10°…+11°), purely decorative (`aria-hidden`, no interaction). |
| Fan fallbacks | Fewer than 2 eligible items with posters → no fan (an empty or artless pool shows the hero exactly as today). The fan never renders posters for seen-excluded items — it samples what the wheel could actually land on. |
| Fan scope | **Desktop only**, by CSS (hidden below 960px) — the mobile hero keeps its current shape. The emblem: corner-mark placement when the fan shows (desktop), centered as today on mobile. |
| Blind mode | The fan is inherently identity-revealing, which is fine: it shows the POOL, not the pick. It renders only in the idle/no-pick state, before anything is chosen — nothing to protect yet. |
| Version | **v1.5.0**. |

## 1. Tonight on stage

- `TonightCard` gains `variant: "card" | "stage"` (default `"card"` — the
  mobile card is byte-identical to today). The **stage variant** renders,
  top to bottom: the ember TONIGHT kicker row (with the existing clear
  button), a **poster** (via `posterUrl`), the serif title, a meta line
  (`year · runtime` when known), the availability chip, Let's Watch /
  Summon / Progress / Mark Watched exactly as the card has them (same
  logic, same handlers — the variant only changes markup/classes).
- **Poster/runtime lookup:** `current_picks` stores no poster, so App
  computes `poolItem = pool.find(i => i.item_key === currentPick.item_key)
  ?? null` and passes it as a new optional `poolItem` prop. Missing
  (pool switched/refreshed since the pick): the stage variant renders the
  existing poster-box fallback surface instead of art, and the meta line
  falls back to the pick's year alone. Never blocks the actions.
- **App wiring (desktop spin view):** `theater__stage` renders
  `{currentPick && <TonightCard variant="stage" poolItem={...} .../>}`
  above the existing `<Stage .../>`; the rail's TonightCard mount is
  removed. Mobile keeps its current above-stage card mount.
- **Respin footer:** CSS-only — when the stage pane contains a Tonight
  stage, the Stage beneath it compresses: divider (`border-top`), reduced
  min-height on the idle hero's slim variant, Spin bar at compact width.

## 2. The poster fan

- Pure helper in `logic.ts`: `fanPosters(items: PoolItem[], n = 4,
  rand = Math.random): string[]` — filters to items with non-null posters,
  samples up to `n` distinct posters, returns their URLs (via `posterUrl`).
  Injectable `rand` so tests are deterministic; returns `[]` when fewer
  than 2 candidates.
- `IdleHero` (full variant only, not the slim ready-line) computes the fan
  once per mount from the same `eligibleItems` result the count uses, and
  renders it as a decorative block (`aria-hidden`) above the kicker.
- CSS: absolutely-positioned tilted posters inside a relative container,
  opacities 0.30/0.45/0.45/0.30, hidden below 960px. When the fan renders
  (CSS-visible or not), the emblem gets a `--corner` modifier at ≥960px
  positioning it top-right of the stage panel at ~30px; below 960px the
  emblem stays centered and the fan is display:none.
- No animation (static set dressing) — nothing for reduced-motion to do.

## 3. What does NOT change

Mobile, in its entirety. All spin/veto/duel/pick/replace contracts. The
Console, switcher, History/Board views. TonightCard's card variant and all
its behavior. Every CLAUDE.md invariant. Frontend-only — no backend or
version-API changes beyond the VERSION constant.

## Testing

- Vitest: `fanPosters` (poster-less filtering, <2 → empty, sample size,
  distinctness, deterministic with injected rand).
- Existing suites stay green (TonightCard default variant unchanged).
- Browser smoke at 1280px: pick committed → Armand-style stage with poster
  + respin footer, rail shows Console first and no Tonight card; clear the
  pick → hero + fan of dimmed posters + corner emblem; spin from the
  footer works (theater plays beneath the Tonight stage). At 390px: mobile
  identical to v1.4.1 (card above stage, no fan, centered emblem).

## Release

**v1.5.0** through the standard pipeline; owner redeploys once via
Dockhand.
