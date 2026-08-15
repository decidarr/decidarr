# Pool browser & seen check-off (v1.8.0)

Tim: "we should be able to open a pool list and see the entire list of
films, and be able to check off films that you've already seen."
Placement chosen via AskUserQuestion: **in Settings, per pool** (over the
spin-screen sheet and both).

## Backend

- `GET /api/pools/{pool_id}/items` — any pool's full item list, same
  shape as `/api/pool` (rank order, decoded genres, derived `item_key`);
  404 `pool_not_found` on a missing id. Read → ungated.
- `POST /api/event` gains `unseen` in its action allowlist. Game
  endpoint → never PIN-gated (invariant #12).
- `db.seen_keys` changes from "ever had a `seen` event" to **latest
  seen/unseen event wins** (max event id per (media_type, item_key)
  among the two actions). Events stay append-only (invariant #2);
  `watched`-flow and backfill still insert `seen`, and a rewatch after
  an `unseen` correctly re-seens because it is later.

## Frontend (Back Office · Pools)

- Each pool row's item-count meta becomes a "View list" action opening a
  detail view inside the section: pool name, back link, search box,
  full list. Rows: checkbox · title (year) · runtime; checked = seen
  (room-wide, from `state.seen[stream]`).
- Toggling posts `seen`/`unseen` attributed to the signed-in player,
  optimistic checkbox, then invalidates `state` so the hero's unseen
  count follows.
- Search is client-side title filtering. 856-row lists render plainly
  (`content-visibility: auto` on rows).

## Testing

- Heaviest on derivation: seen→unseen hides, seen→unseen→seen restores,
  stream scoping, watched/backfill interplay unchanged.
- Route: shape + 404. Event: unseen accepted, bad actions still 422.
- Browser smoke: browse, search, check + uncheck round-trip, hero count
  moves.
