# Decidarr v1.4 — List Switcher + Plex Library Pools: Design Specification

**Date:** 2026-07-31
**Status:** Approved in brainstorming; ready for implementation planning
**Prerequisite reading:** `docs/specs/2026-07-11-decidarr-v1-design.md` (pool
model, one-active-per-stream) and
`docs/superpowers/specs/2026-07-20-watched-backfill-design.md` (the Plex
library scan this reuses).

## What it is

Three things, shipping together with two already-fixed v1.3 defects:

1. A **"Watching from" switcher** at the top of the Console, so the room can
   change which list the wheel draws from without going to Settings.
2. A **`plex` pool source** — a pool fed by chosen sections of the owner's
   own Plex library, so a new install has something real to spin over
   without importing anything.
3. **Decidarr's first schema migration**, required by (2): widening
   `pools.source`'s CHECK constraint.

## Decisions (settled in brainstorming)

| Question | Decision |
|---|---|
| Switcher scope | **Switches the room's active list** — the same global, one-active-per-stream activation Settings performs today. Not per-player view state (that would break the shared-room model and "tonight's pick"). |
| Switcher gating | **Admin-PIN gated** via the existing `withAdminPin`, because activation is a settings write (invariant #12). Ungated switching was rejected. |
| Switcher placement | **Top of the Console** ("Watching from" row, above "How long have we got?"). Not the header (crowds the mobile bar we just simplified) and not the hero kicker (too small a target; hides a settings action in decorative copy). |
| Plex list contents | **Everything in chosen library sections.** The owner ticks which sections feed the pool. Already-watched titles drop out through the existing seen set + backfill rather than a second watched mechanism. Not unwatched-only (duplicates seen logic, makes rewatches unspinnable). |
| Section choice | Sections are **discovered and ticked in the UI**, never typed as ids. |
| Schema | **Proper migration**: rebuild `pools` with `source IN ('custom','tmdb','trakt','plex')`. Rejected piggybacking on `source='custom'` with a config marker, which would make "custom" mean two things. |
| Blind meta line | **Runtime only** while masked. Year, rating and rank are the giveaways; runtime answers the fair question ("have we got time?"). |
| Version | **v1.4.0**, bundled with the v1.3.1 slider/blind fixes (commit 5b32fb2) so the owner redeploys once. |

## 1. The "Watching from" switcher

- New first block in `Console`: a mono label (`S.pools.watchingFrom`) and a
  `<select>` of every pool whose `media_type` matches the current stream,
  with the active pool selected.
- Changing it calls `activatePool(id)` through `withAdminPin`, then
  invalidates the `state` and `pool` queries so the hero kicker, eligible
  count, and wheel all follow in one beat.
- **Hidden entirely when the stream has fewer than two pools** — a
  one-option select is noise.
- Pool list comes from `GET /api/pools` (already exists, ungated). A new
  `pools` React Query key; no backend change for the switcher itself.
- Failure (wrong PIN, cancelled, write error) toasts via `pinAwareMessage`
  and leaves the selection where it was.

## 2. The `plex` pool source

**`backend/pools/plex.py`** — mirrors the shape every other source has
(`make_client()` + `async fetch(client, source_config, media_type)`):

- `source_config` is `{"sections": ["1", "3"]}` (Plex section keys as
  strings).
- `fetch` walks `/library/sections`, keeps the configured sections whose
  type matches `media_type` (`movie` → movie, `tv` → show), then pulls
  `/library/sections/{key}/all?includeGuids=1` per section and yields
  `{tmdb_id, title, year, rank}` records — the same shape `trakt.fetch`
  returns, so `refresh._diff`/enrichment work unchanged and TMDB fills in
  posters/runtime/genres as usual.
- A section that fails is **skipped, not fatal** (the batch survives);
  `make_client` raises the standard "Not configured" RuntimeError when Plex
  isn't set up, which `refresh_pool` already surfaces as an admin-visible
  error. Media-server-agnostic seam: registered in `pools.get_source`.
- Rank is enumeration order (Plex has no ranking); titles are deduped by
  `(tmdb_id or normalized title+year)` across sections.

**`GET /api/plex/sections`** (admin-gated) — returns
`[{key, title, type}]` for movie/show sections so the UI can offer
checkboxes. Returns `{"ok": false, "message": ...}`-style empty list rather
than 5xx when Plex is unconfigured or unreachable (invariant #1).

**Settings → Pools** gains "Plex library" as a source option; choosing it
fetches the sections and shows a checkbox per section. Create is blocked
with a clear message when Plex isn't configured (mirroring how `trakt`
create already 422s on `trakt_unconfigured`).

## 3. The migration

`pools.source`'s CHECK constraint cannot be altered in place, so `db.py`
gains a versioned migration step run once from `init_db()`:

```
BEGIN;
  CREATE TABLE pools_new(... source TEXT NOT NULL
      CHECK(source IN ('custom','tmdb','trakt','plex')) ...);
  INSERT INTO pools_new SELECT id, name, media_type, source, config,
      active, refreshed_at FROM pools;
  DROP TABLE pools;  ALTER TABLE pools_new RENAME TO pools;
COMMIT;
```

- **Guarded**: only runs when the existing table's SQL lacks `'plex'`
  (read from `sqlite_master`), so it is a no-op on fresh installs (whose
  `CREATE TABLE IF NOT EXISTS` already has the new constraint) and on
  already-migrated databases. Idempotent across restarts.
- **PRAGMA foreign_keys is OFF during the rebuild** and restored after —
  `items.pool_id` references `pools(id)`, and the ids are preserved
  verbatim by the copy, so item→pool links survive.
- **Asserted**: the migration counts rows before and after and raises if
  they differ, refusing to leave a half-migrated database.
- Tested against a database created with the v1.3-shaped schema, proving
  pools, their ids, and their items all survive.

## 4. Blind meta line

`formatMetaLine(item, stream)` grows a third parameter `masked = false`.
When masked it returns runtime only (`"73m"`, or `""` when runtime is
unknown); otherwise it behaves exactly as today. `PickCard` passes its
existing `masked` flag. Pure function, so the rule is unit-tested rather
than living in JSX.

## 5. What does NOT change

Pool refresh cadence and reconciliation; the seen/backfill machinery; the
spin/veto/duel/pick contracts; the Console's filters and presets; the
desktop theater; all copy staying in `strings.ts`; every other invariant.
Apart from the constraint widening, the change is additive.

## Testing

- **Migration**: build a v1.3-shaped DB with pools + items, run `init_db`,
  assert the constraint now admits `'plex'`, and that pool rows, ids, and
  item links are intact; run it twice to prove idempotence.
- **`pools.plex.fetch`** (`httpx.MockTransport`): section-type filtering
  per media_type, record shape, cross-section dedupe, a failing section
  skipped without emptying the pool, unconfigured → the standard error.
- **`GET /api/plex/sections`**: shape, admin gate, unconfigured/unreachable
  degrade cleanly (never 5xx).
- **`formatMetaLine` masked**: runtime only, missing runtime, unmasked
  unchanged.
- **Frontend**: switcher hidden with <2 pools, visible and defaulting to
  the active one otherwise.
- **Browser smoke**: create a second pool, switch lists from the Console,
  confirm hero kicker + eligible count + wheel all follow; blind pick shows
  runtime only.

## Release

**v1.4.0**, carrying the v1.3.1 slider/blind-mode fixes, through the
standard pipeline (suites → merge → tag → CI → Docker Hub → owner
redeploys once via Dockhand).
