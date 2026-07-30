# Decidarr v1.2.3 — Landing Hero: Design Specification

**Date:** 2026-07-20
**Status:** Approved in brainstorming; ready for implementation planning
**Prerequisite reading:** `docs/specs/2026-07-11-decidarr-v1-design.md`
(layout contract: header → tonight card → stage → spin bar in the thumb arc).

## What it is

A warm welcome for the stage's idle phase, replacing the blank placeholder
box that currently greets a player on load. Modeled on what Swamp Roulette's
landing did well — a ritual kicker, a plain-words invitation, and a live
"choosing from N unseen films" count — rendered in Decidarr's existing dry
voice. Frontend-only; no backend or API changes.

## Decisions (settled in brainstorming)

| Question | Decision |
|---|---|
| Scope | **Warm hero in the idle space.** The hero replaces `IdlePoster` in the idle phase only. Header, tonight card, spin bar, and every other phase (spinning, landed, empty, loading) are untouched. |
| Tone | **Ritual + dry wit** — Swamp Roulette's warmth ported into the strings.ts personality, not a verbatim SR homage and not neutral-minimal. |
| Live data | **Pool name + smart count.** Kicker carries the active pool's name; the count line adapts to stream (films/shows) and appends "that fit your filters" only when filters are active. |
| With a tonight pick | **Slim ready-line.** Full hero only when no pick exists for the current stream; under a committed pick the stage shows just the quiet count line, deferring to the Tonight card. |
| Zero eligible | Count renders honestly ("…0 unseen films that fit your filters"). Spin then lands on the existing empty-wheel state with its one-tap fixes — no duplicated fix buttons in the hero. |
| No active pool | Kicker drops the pool name; count line is replaced by the existing `emptyWheel.noPool` nudge. |
| Pool query loading | Existing skeleton keeps rendering; the hero never flashes a wrong count. |

## States

The idle phase becomes a three-way switch (all other phases unchanged):

1. **Idle, no tonight pick (current stream)** → full hero:
   - **Kicker** — small gold mono caps, same treatment as the Tonight card's
     "TONIGHT" label: `<POOL NAME> · TONIGHT, WE WATCH`.
   - **Invitation** — ~2 sentences, e.g. "Hit the button and let the wheel
     decide. It draws from whatever your filters allow and skips everything
     you've already seen." (Exact copy polished at implementation; this is
     the register.)
   - **Count line** — dim: `Choosing from 214 unseen films.` /
     `…that fit your filters.` when filters are active.
2. **Idle, tonight pick exists (current stream)** → slim ready-line only:
   e.g. `Another 213 in the wheel.`
3. **Idle, pool still fetching** → existing skeleton.

## Implementation shape

- **`IdleHero`** block in `frontend/src/components/Stage.tsx` replacing
  `IdlePoster` in the idle phase. Everything it needs is already in scope:
  the pool query (name + items), filters, seen list, and the tonight-pick
  presence (the same `state` data TonightCard mounts from).
- **Count derivation:** `eligibleItems(pool.items, filters, seen).length` —
  the same function Spin draws from, so the displayed number can never
  disagree with what Spin actually does.
- **Pure helper in `logic.ts`** for the count-line/ready-line copy
  (pluralization, films vs shows, filters-active suffix, zero case) so the
  fiddly logic is vitest-tested, not buried in JSX.
- **All player-facing copy in `strings.ts`** (house rule #10); no functional
  emoji; Lucide only if any icon is used at all.
- **Styles in `app.css`** with existing tokens; the hero is static text —
  nothing needed for `prefers-reduced-motion`.

## Testing

- Vitest: the copy helper (singular/plural, movies/shows, filters on/off,
  zero, ready-line variant); existing suites stay green.
- Browser smoke on a seeded local instance: hero renders with real pool
  data; spin still works from the hero; slim variant appears once a pick is
  committed; empty-pool nudge shows when no pool is active.

## Release

Ships in **v1.2.3** together with the Plex availability badge fix
(`includeGuids=1` on the `/search` call in `backend/media/plex.py` — proven
against the live server; makes the exact-TMDB rung reachable so definitive
"In your library" can actually appear) and the watched-backfill import
(specified separately in `2026-07-20-watched-backfill-design.md`).
