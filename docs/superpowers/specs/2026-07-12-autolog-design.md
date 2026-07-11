# Decidarr v1.2 — Auto-log Watches: Design Specification

**Date:** 2026-07-12
**Status:** Approved in brainstorming; ready for implementation planning
**Prerequisite reading:** `docs/specs/2026-07-11-decidarr-v1-design.md` (the v1
design; its "v1.2 (committed follow-up)" section reserved the hooks this
feature uses).

## What it is

A background poller that watches the configured media server's playback
history and inserts `watched` events automatically when a pool item is played
to completion — no more tapping "Mark watched" after the credits. The existing
`watched` side-effects ride along unchanged: `seen` is auto-inserted (the
wheel stops offering the item) and the matching `current_picks` row is cleared
(the tonight card retires itself).

v1 deliberately reserved three hooks so this feature is **additive only**:
`players.plex_user` / `players.jellyfin_user` (nullable columns),
`events.source` (`CHECK(source IN ('user','auto'))`, default `'user'`), and
the `MediaServer.recent_watches(client, since)` stub in both backends. No
schema migration is required or permitted.

## Decisions (settled in brainstorming)

| Question | Decision |
|---|---|
| Detection mechanism | **History polling** — trust the media server's own watched determination (Plex/Jellyfin each flip their watched flag at ~90% played). No session tracking, no webhooks (Plex webhooks are Plex-Pass-only; Jellyfin needs a plugin; both need inbound reachability). |
| Completion threshold | None of our own. A play counts when the server records it as watched. Decidarr always agrees with what the user sees in Plex/Jellyfin. |
| Attribution | Mapped player first (`plex_user`/`jellyfin_user`, case-insensitive username compare, active players only). Unmapped account + the played item is tonight's committed pick → attribute to `picked_by`. Otherwise skip. |
| TV semantics | **Any completed episode** of a show logs the show watched — parity with the manual "Mark watched" tap, and with v1's watchable-first philosophy. The play record carries the *show's* identity. |
| Scope | Items in either stream's **active pool**, plus **current picks** (relevant even if the pool has changed). Non-pool viewing is ignored. |
| Cadence | Every **300 s** by default; setting `autolog_interval` (seconds), re-read each cycle so changes apply without restart. |
| Enablement | **On by default** whenever a media server is configured; kill switch `autolog_enabled` (settings toggle, admin-gated). Degrades to a no-op when unconfigured — invariant #1 style. |
| Backfill | **None.** On first run the watermark initializes to "now"; historical plays are never mass-imported into the scoreboard. |
| Rewatches / multi-account | Two mapped accounts finishing the same title → two events (both players genuinely watched; the duplicate seen/pick effects are no-ops). A rewatch after the watermark is a legitimately new event. |

## Architecture

Three touch-points, all additive:

```
app.py lifespan ──► asyncio task: _autolog_loop()          (mirrors _daily_refresh)
                        │  every autolog_interval seconds
                        ▼
                    autolog.poll_once()                     (new module — the seam)
                        │ 1. enabled + backend configured?  else no-op
                        │ 2. watermark = settings[autolog_watermark]
                        │ 3. plays = backend.recent_watches(client, since=watermark − 60s)
                        │ 4. match plays → (media_type, item_key) against
                        │      active-pool items + current_picks
                        │ 5. attribute → player (mapping, else picked_by, else skip)
                        │ 6. dedupe (events-existence check)
                        │ 7. db.log_event(..., action="watched",
                        │                 source="auto", ts=played_at)
                        ▼
                    media/plex.py · media/jellyfin.py       recent_watches() implemented
```

### `recent_watches(client, since)` — normalized play records

Both backends return the same shape:

```python
{"account": str,          # media-server username (for mapping)
 "media_type": "movie"|"tv",
 "tmdb_id": int|None,     # of the MOVIE or the SHOW (never the episode)
 "title": str, "year": int|None,   # ditto — show identity for episodes
 "played_at": str}        # ISO-8601 UTC, the server's completion time
```

- **Plex:** `GET /status/sessions/history/all` filtered to entries with
  `viewedAt` ≥ since (Plex writes a history entry exactly when it marks the
  item watched). Per new play, one `GET /library/metadata/{ratingKey}` to
  extract the TMDB guid (for episodes, the *grandparent* show's metadata).
  One `GET /accounts` call resolves numeric `accountID` → username.
- **Jellyfin:** enumerate users (`GET /Users`), then per user
  `GET /Users/{id}/Items?IsPlayed=true&SortBy=DatePlayed&...` with
  `fields=ProviderIds,ProductionYear`, filtered by `UserData.LastPlayedDate`
  ≥ since. Episodes resolve their series' identity via `SeriesId` (one series
  lookup per distinct show seen). No history endpoint exists; recently-played
  is the equivalent.
- **Contract:** same as every integration module — catch
  `(httpx.HTTPError, ValueError)` and return `[]`. Never raise.

### Matching (conservative on purpose)

A mis-log marks an item seen and yanks it from the wheel, so matching mirrors
Sonarr's exact-only caution:

1. `(media_type, tmdb_id)` exact against active-pool items + current picks.
2. Else `(media_type, normalize(title), year)` — **exact year only, no ±1
   fuzz** (unlike availability's fuzzy rung, which merely softens a label).
3. Else skip the play entirely.

Identity is always `(media_type, item_key)` per invariant #3.

### Dedupe & watermark (no new tables — invariant #2)

- The auto event's `ts` **is** the server's `played_at`. "Already logged" is
  then a pure existence check: skip when an events row exists with
  `action='watched' AND source='auto'` and the same
  `(player, media_type, item_key, ts)`.
- The watermark is one `settings` key (`autolog_watermark`, ISO UTC). It
  advances to `max(played_at)` of the fetched plays **only after a successful
  poll**; a failed fetch leaves it untouched so the next cycle retries the
  same window. A successful poll that returns zero plays also leaves it
  untouched — deliberate: the watermark only ever moves to a timestamp the
  server itself asserted, so cross-clock skew can never skip a play. (Cost: a
  quiet stretch widens the fetch window; the existence-check dedupe makes the
  wider window harmless.) Fetches use a 60-second overlap
  (`since = watermark − 60s`) to tolerate jitter and equal timestamps.
- First run (key absent): initialize to now. No backfill.

### `db.log_event` extension (additive)

```python
def log_event(conn, player, media_type, item_key, title, year, action,
              source="user", ts=None):   # ts=None → utc_now()
```

Defaults preserve v1 behavior byte-for-byte. The companion `seen` insert uses
the same `ts`/`source`; the pick-clear is unchanged.

### Poller loop (`app.py`)

Registered in the lifespan next to `_daily_refresh`; cancelled on shutdown the
same way. Sleeps `int(resolve("autolog_interval") or 300)` seconds, re-read
each cycle. `poll_once()` is wrapped in `try/except` — no exception can kill
the loop. Single-process assumption unchanged (this is another reason the
worker count stays 1).

## API & UI surface

| Change | Detail |
|---|---|
| `PATCH /api/players/{id}` | **New endpoint** (v1 only had create/deactivate). Admin-gated. Accepts exactly two optional nullable fields: `plex_user`, `jellyfin_user`. Editing `name`/`emoji` is out of scope. |
| Settings → Players | Each player row gains two optional text fields — "Plex user" / "Jellyfin user" — each rendered only when that server is configured. |
| Settings toggle | "Auto-log watches" switch → `autolog_enabled` (default on), admin-gated like all settings writes. |
| `SETTING_ENV` | `AUTOLOG_ENABLED` → `autolog_enabled`, `AUTOLOG_INTERVAL` → `autolog_interval` (env seeds/overrides, compose-first users never open the UI). `compose.yaml` gains both, commented. |
| History | `db.history()` starts returning the existing `source` column; auto rows get a small "auto" tag (Lucide `Zap` + text from `strings.ts` — no functional emojis). |
| `/api/health` | Gains `autolog: bool` (enabled AND media server configured). |

## Error handling

1. `recent_watches` failure (config, connectivity, malformed body) → `[]`,
   watermark holds, poll retries next cycle. Never raises.
2. `poll_once` is exception-proofed at the loop; a bug can degrade auto-log,
   never the app.
3. Auto-log's health never affects spin/veto/duel/summon (invariant #1).
4. Attribution failure (unmapped, not the pick) is a silent skip by design —
   logged plays must always be explainable.

## Testing

- **MockTransport** (both backends): movie play normalized; episode play →
  show identity; account-id → username resolution (Plex); malformed-JSON 200
  and connection failure → `[]`.
- **`poll_once` unit tests** (tmp DB, monkeypatched `recent_watches`):
  mapped attribution; unmapped → picker fallback when item is the pick;
  unmapped non-pick skipped; non-pool play skipped; TV episode logs the show
  and clears the TV pick; same play across two polls → one event; watermark
  advances on success and holds on failure; `autolog_enabled=0` → no-op;
  first run sets watermark to now and logs nothing historical; case-insensitive
  username match; deactivated player's mapping ignored.
- **API tests:** `PATCH /api/players/{id}` happy path + admin-PIN gate (401
  wrong pin); history rows expose `source`; health exposes `autolog`.
- **Manual (MudBox smoke):** watch a real pool film on Plex → tonight card
  clears within ~5 minutes and the scoreboard credits the right player; same
  for a Jellyfin episode play against a TV pick.

## Explicitly out of scope

- Episode-level TV tracking (still v2 parking lot).
- Webhooks / real-time push.
- Backfilling historical plays.
- Editing `name`/`emoji` via the new PATCH endpoint (mapping fields only).
- Emby (whenever an Emby backend lands, it implements `recent_watches` like
  the others).
