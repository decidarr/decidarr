# Decidarr v1.2.3 — Watched Backfill: Design Specification

**Date:** 2026-07-20
**Status:** Approved in brainstorming; ready for implementation planning
**Prerequisite reading:** `docs/superpowers/specs/2026-07-12-autolog-design.md`
(auto-log's matching maps and its deliberate no-backfill watermark rule,
which this feature complements rather than changes).

## What it is

A one-tap, re-runnable import that marks pool items the household has
already watched (per the media server's own watched flags) as `seen`, so
they stop coming up on the wheel. Closes the gap auto-log leaves by design:
auto-log only observes plays *after* it was enabled; titles watched before
that keep spinning. Plex-first (`MEDIA_SERVER=plex`); the seam is
backend-generic so Jellyfin can implement the same method later.

## Decisions (settled in brainstorming)

| Question | Decision |
|---|---|
| Event type | **`seen` only, `source='auto'`** — never `watched`. The wheel stops offering the title (the actual complaint) but the scoreboard and History keep meaning "things that happened through Decidarr". Auto-log's "historical plays are never mass-imported into the scoreboard" promise stands. (Schema verified: `action='seen'` + `source='auto'` are both legal today; no migration.) Board's headline line relabeled "Titles seen" (was "Total watched") so the seen-derived count stays honest post-backfill. |
| Scope | **Active pools, both streams.** Every item in the active Movies pool and active TV pool is checked; non-pool viewing is ignored (same philosophy as auto-log). Bounded work regardless of library size. |
| Trigger | **Admin-gated Settings button**, "Import watched from Plex", placed with the media-server card. Explicit, visible, re-runnable after loading a new pool. |
| Matching | **Exact-only**: TMDB id first (`tmdb://` guid), then normalized title + year — the same matchable-maps approach as `autolog._matchable`. No fuzzy matching: a wrong guess would silently remove an unwatched film from the wheel. |
| TV semantics | Any watched episode (`viewedLeafCount >= 1` on the show) → the show is seen. Watchable-first parity with auto-log and "Mark watched". |
| Attribution | The player who pressed the button (sent by the UI from session state). Verified: `seen_keys()` is room-global (DISTINCT item_key, no player filter), so attribution is cosmetic for wheel behavior — but events must always be explainable, and "who ran the import" is the honest answer. |
| Dedupe / re-runs | Items already in the seen set are skipped and counted separately. Re-running is always harmless. |
| Failure mode | Invariant #1: Plex unreachable/unconfigured → clean `{ok: false, message}` (like the connection-test route), never a 5xx. Partial section failures skip that section, keep the batch. |

## Architecture

```
Settings button ──► POST /api/backfill-seen {player: id}   (admin-gated)
                        │ 1. backend = get_backend(); Plex configured?
                        │      else {ok:false, message}
                        │ 2. watched = plex.watched_keys(client)
                        │      bulk: /library/sections → per-section
                        │      /all?includeGuids=1, keep viewCount>=1
                        │      (movies) / viewedLeafCount>=1 (shows),
                        │      normalized to {tmdb_id, title, year} per type
                        │ 3. match against BOTH active pools' items:
                        │      exact tmdb_id, else normalized title+year
                        │ 4. skip keys already in seen_keys(conn, mt)
                        │ 5. log_event(..., action="seen", source="auto",
                        │               player=<requester>)
                        ▼
                    {ok, marked_movies, marked_tv, skipped_seen}
```

- **`plex.watched_keys(client)`** — new method in `backend/media/plex.py`,
  same never-raise contract as its siblings: `(httpx.HTTPError, ValueError)`
  caught, per-section isolation.
- **Route in `app.py`** beside the connections routes, `require_admin`.
- **Settings UI**: button + result line in the media-server card area
  (`strings.ts` copy, e.g. "Marked 87 films + 3 shows seen. 12 already
  seen."), disabled while running, hidden when no media server is active.

## Testing

- Backend (httpx.MockTransport, per house convention): watched flags
  filtering (movie viewCount / show viewedLeafCount), exact-only matching
  (tmdb hit, title+year hit, near-miss NOT matched), already-seen skip
  counting, unconfigured → `ok:false`, section-failure isolation, admin
  gating, and a re-run producing zero new events.
- Frontend: button visibility (media server active/absent) and the result
  summary string helper.
- MudBox smoke after deploy: run the import for real, confirm the wheel's
  eligible count drops and previously-watched titles stop appearing.

## Release

Ships in **v1.2.3** with the landing hero
(`2026-07-20-landing-hero-design.md`) and the `includeGuids=1` availability
badge fix.
