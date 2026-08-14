# Settings: The Back Office (v1.7.0)

Tim's verdict on the current Settings: "way too chunky, so much empty
space on all of the bars," pointing at Plex Web's settings as the model.
Mockup B ("The Back Office") chosen over A ("Tight Ledger") on
2026-08-14 via the visual companion.

## Shape

One `Settings` shell with internal section navigation — no router; a
`useState<Section>` mirrors how `App` switches views.

- Sections: `players`, `pools`, `autolog`, `connections`.
- **≥960px**: slim left rail (~170px) listing the sections, active one
  gold; app version (from `/api/health`, already queried in Settings)
  tucked at the rail's foot in mono. Content is a single compact column
  (~640px max) showing ONE section at a time.
- **<960px**: the rail becomes a horizontal chip row above the content —
  same state, same one-section-at-a-time behavior. Mobile loses the
  scroll-past-everything page it has today.
- TMDB attribution stays as the content column's footer on every section.

## Density pass (Settings-scoped only)

Game surfaces are untouched — every rule is scoped under `.settings-view`.

- Controls drop from 44px bars to ~30px: inputs, selects, buttons.
- Full-width gold slabs (Add player, Create pool) become auto-width
  compact primaries on the form row's right.
- Players: one hairline row each — name (+emoji), the media-server
  mapping input inline with a quiet label on its left (Plex-style
  label-left), Remove as a small link on the right.
- Pools: one hairline row — name, ACTIVE badge, mono meta
  (`300 · 14 Aug`), then right-aligned chip actions (Refresh / Activate /
  Delete / Upload). Create-pool is one inline row; trakt/plex source
  extras wrap onto a second line only when chosen.
- Connections: label-left field grid (`110px 1fr`) per service card,
  Test/Save right-aligned on one row. Media-server card and backfill row
  get the same treatment.
- Hairline separators (existing `--line` at ~55% alpha) replace padded
  card chrome inside sections; connection cards keep a quiet panel.

## Non-goals

- No behavior changes: every handler, admin-PIN gate, and query is
  untouched. This is markup + CSS + one nav state.
- No new strings beyond nav labels (section titles already exist).
- No backend changes beyond the version bump.

## Testing

- Existing suites must stay green (backend 186 / frontend 57).
- Browser smoke at 1280px (rail) and 390px (chips): all four sections
  reachable, player add + pool actions + connection fields render, one
  section visible at a time.
