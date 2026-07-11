# Decidarr v1 — Design Specification

**Date:** 2026-07-11
**Status:** Draft for Tim's review
**Repo:** github.com/decidarr/decidarr
**Heritage:** Clean-room rebuild of Swamp Roulette (v1 → v1.2), generalized for public release. Feature set is Swamp Roulette parity plus a TV stream; no ported code.

## What it is

Decidarr is a self-hosted watch-night decision engine for the *arr stack.
It runs two independent streams — **Movies** and **TV** — each with its own
curated pool and its own wheel; a spin session is always one or the other,
never a mixed pot. Spin the wheel, and the pick is availability-checked
live against your media server; if you don't have it, one tap summons it
through Overseerr/Jellyseerr and a live progress bar (fed by Radarr's or
Sonarr's queue) tracks the download until it lands. Veto tokens,
head-to-head duels, blind picks, a grudge list, and a scoreboard turn
choosing into a game instead of an argument.

## Goals (v1 scope)

1. **Core loop:** spin → live availability verdict → summon → download
   progress → watch.
2. **Two streams: Movies and TV.** Independent pools, wheels, filters, and
   histories per stream; a header toggle switches streams. Never mixed in
   one spin. Movies flow through Radarr, TV through Sonarr — both via
   Overseerr/Jellyseerr for requests.
3. **Configurable players** (2+, admin-defined, tap-to-identify). No
   hardcoded names anywhere. Players are shared across both streams.
4. **Pluggable pools:** admin picks the pool source(s) per stream; items
   are fetched and cached server-side with metadata. v1 sources: Custom
   list (JSON/CSV import), TMDB list, Trakt list — each usable for either
   stream.
5. **Media server support: Plex AND Jellyfin**, behind one interface.
6. **Social mechanics at Swamp Roulette parity:** veto tokens (N per player
   per night, default 1, shared across streams), duels (incl. per-slot
   "seen it" re-spin and rematch), blind pick, grudge list, scoreboard,
   shared history.
7. **Filters:** runtime dual-handle range slider (with mood presets; for TV
   this filters on episode runtime), genre, decade/year, include-seen
   toggle (seen items excluded by default).
8. **Single Docker container**, mobile-first PWA, installable to phones.
9. **Feels native to the *arr stack.** Setup follows the conventions *arr
   users already know: each integration (Seerr, Radarr, Sonarr, Plex,
   Jellyfin, TMDB, Trakt) is configured in Settings → Connections as
   URL + API key with a **Test** button that round-trips the credential
   and shows the familiar green check. Docker conventions match the
   ecosystem (`TZ`, volume-mounted data, env-var overrides for
   compose-first users, `URL_BASE` for reverse proxies).
10. **Never break the core on optional integrations** — availability,
    summoning, and progress each degrade gracefully and independently.

## Non-goals (explicitly deferred)

- Music, books, other media types (movies and TV only)
- Authentication (reverse proxy is the lock; players are identities, not
  accounts)
- Auto-log watches from Plex/Jellyfin playback (**committed for v1.2**, not
  v1 — see below)
- Letterboxd and mdblist pool sources (interface supports them; not built)
- Emby (Jellyfin module likely near-compatible; untested, unclaimed)
- Taste weighting / recommendations (Decidarr picks, it does not recommend)
- Multiple simultaneous active pools per stream (one active pool per
  stream in v1; schema allows more)
- Episode-level TV tracking (v1 picks and summons *shows*; which episode
  you're up to is between you and your media server)

## Architecture

One Docker container, port 5454 (configurable).

```
Browser (React PWA, phones first; tablet/desktop = same column)
   │ same origin
   ▼
FastAPI ──► serves /  (built React bundle, static)
   │        /api/*    (JSON API)
   │        SQLite /data/decidarr.db (volume)
   │
   ├── seerr.py      Overseerr/Jellyseerr: search, match, request (movie + tv)
   ├── radarr.py     Radarr: queue → download progress state machine (movies)
   ├── sonarr.py     Sonarr: queue → download progress state machine (tv)
   ├── media/        MediaServer interface
   │     plex.py       availability + deep link (X-Plex-Token)
   │     jellyfin.py   availability + deep link (API key)
   └── pools/        PoolSource interface
         custom.py     admin-imported JSON/CSV
         tmdb.py       TMDB list id
         trakt.py      Trakt list slug/id
```

**Module rules (the seams that matter):**
- Each external service gets exactly one module owning its HTTP + shaping:
  `config() -> credentials resolved at call time` (env var wins, else
  settings table), `make_client() -> httpx.AsyncClient`, and pure-ish
  async functions driven by an injected client (testable with httpx
  MockTransport).
- `sonarr.py` mirrors `radarr.py`'s shape exactly (config/make_client/one
  async progress lookup) — same states, same never-raise contract. For TV
  the queue can hold many episodes of one series: progress aggregates them
  (percent = size-weighted mean across the series' queue records; label
  includes an episode count).
- **ID mapping (critical):** Radarr speaks TMDB, but **Sonarr's canonical
  id is TVDB** — do not assume Sonarr can be queried by tmdb_id. When a
  summon succeeds, capture the external ids from Seerr's response
  (`mediaInfo.tvdbId` / `tmdbId`) and persist them on the pick. `sonarr.py`
  looks up the series by `tvdbId`, falling back to exact-title+year against
  `/api/v3/series` when tvdb is missing. If neither resolves, progress
  returns `unknown` (bar hidden) — never a wrong series' bar.
- **TV "done" is watchable-first:** the progress state machine flips to
  `done` the moment the **first episode** of the requested season imports
  ("▶ Episode 1 is ready — start watching"), while remaining episodes
  continue in a background label ("3 of 10 landed"). Full-season completion
  is not the gate; watchability is.
- `MediaServer` interface: `availability(client, item, media_type) ->
  (verdict, confidence)` and `deep_link(item) -> url|None`. Backend chosen
  by env (`MEDIA_SERVER=plex|jellyfin`). **Match ladder, specified per
  backend:** (1) provider-id exact — Plex GUID `tmdb://<id>` /
  `tvdb://<id>`, Jellyfin `AnyProviderIdEquals`; (2) exact normalized
  title + year; (3) normalized title ± 1 year. Rungs 2–3 return
  `confidence:"fuzzy"`, which the UI renders as "probably in your library"
  rather than a hard ✓. A show counts as `available` when it has at least
  one playable episode. **Deep links are constructed, not guessed:** Plex
  needs the server's `machineIdentifier` (fetched once at connection-test
  time, cached in settings) →
  `https://app.plex.tv/desktop#!/server/<machineId>/details?key=/library/metadata/<ratingKey>`;
  Jellyfin → `<JELLYFIN_URL>/web/index.html#!/details?id=<itemId>`. Adding
  Emby later = one file.
- `PoolSource` interface: `fetch(client, source_config, media_type) ->
  list[PoolItem]`. All sources resolve to the same normalized item shape
  (below). Adding Letterboxd later = one file.
- Optional integrations NEVER raise for config/connectivity problems; they
  return sentinel states (`unknown`, `unconfigured`) the frontend knows to
  render benignly. Proven pattern from Swamp Roulette v1.2.

## Data model (SQLite, WAL mode)

```sql
players(
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE,
  emoji   TEXT,                        -- avatar chip
  active  INTEGER NOT NULL DEFAULT 1,  -- soft delete; history survives
  plex_user     TEXT,                  -- reserved for v1.2 auto-log mapping
  jellyfin_user TEXT                   -- reserved for v1.2 auto-log mapping
)

pools(
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
  source  TEXT NOT NULL CHECK(source IN ('custom','tmdb','trakt')),
  config  TEXT NOT NULL,               -- JSON: list id/slug/import ref
  active  INTEGER NOT NULL DEFAULT 0,  -- exactly one active pool per media_type
  refreshed_at TEXT
)

items(                                  -- normalized cache, all sources, both streams
  id       INTEGER PRIMARY KEY,
  pool_id  INTEGER NOT NULL REFERENCES pools(id),
  media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
  tmdb_id  INTEGER,                    -- canonical identity when known
  title    TEXT NOT NULL,
  year     INTEGER,                    -- release year / first-air year
  runtime  INTEGER,                    -- minutes; for tv: typical episode runtime
  seasons  INTEGER,                    -- tv only, else NULL
  genres   TEXT,                       -- JSON array
  rating   REAL,                       -- TMDB vote_average 0-10 (enrichment is always TMDB)
  rank     INTEGER,                    -- position in source list, if any
  poster   TEXT,                       -- TMDB poster path
  UNIQUE(pool_id, tmdb_id)
)

events(
  id       INTEGER PRIMARY KEY,
  ts       TEXT NOT NULL,              -- ISO 8601 UTC
  player   INTEGER NOT NULL REFERENCES players(id),
  media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
  item_key TEXT NOT NULL,              -- "tmdb:<id>" or "t:<title>|<year>"
  title    TEXT NOT NULL,
  year     INTEGER,
  action   TEXT NOT NULL CHECK(action IN
           ('spun','vetoed','watched','seen','requested','duel_won')),
  source   TEXT NOT NULL DEFAULT 'user'
           CHECK(source IN ('user','auto'))  -- 'auto' unused until v1.2
)

current_picks(                          -- tonight's pick, one per stream (mutable state, not history)
  media_type TEXT PRIMARY KEY CHECK(media_type IN ('movie','tv')),
  item_key   TEXT NOT NULL,
  title      TEXT NOT NULL,
  year       INTEGER,
  tmdb_id    INTEGER,
  tvdb_id    INTEGER,                   -- tv: captured from Seerr at summon; Sonarr's key
  picked_by  INTEGER NOT NULL REFERENCES players(id),
  ts         TEXT NOT NULL
)

settings(key TEXT PRIMARY KEY, value TEXT)   -- misc admin-set values
```

Everything social is **derived from events** (the Swamp Roulette insight —
no state tables to corrupt):

| Derived | Rule |
|---|---|
| Seen list | distinct (media_type, item_key) with a `seen` event; `watched` auto-inserts `seen` |
| History | `watched` + `requested`, newest first (stream-filtered by view) |
| Grudges | (media_type, item_key) with ≥2 `vetoed`, per-player counts |
| Veto token | N/player/night **across both streams** (N = `veto_tokens` setting, default 1): available iff fewer than N `vetoed` by player today in `TZ` |
| Scoreboard | COUNT(*) per action per player + `duel_won` totals + top grudges (per stream + combined) |

Note `duel_won` is in the CHECK constraint from day one — the migration
Swamp Roulette deferred costs nothing in a fresh schema.

`item_key` uses `tmdb:<id>` whenever the pool item has a tmdb_id, falling
back to normalized `title|year`. Combined with `media_type` this keeps
history stable across pool changes and source switches (TMDB movie and TV
id spaces overlap, so media_type is always part of identity).

### Tonight's pick (survives navigation, refresh, and other phones)

The chosen film must not live only in browser memory — losing a summoned
pick (and its progress bar) to a stray tap was a real Swamp Roulette pain.
`current_picks` holds **one row per stream**, upserted server-side whenever
a pick is *committed*: a summon succeeds, a "watch now" is tapped, or a
duel winner is crowned. A plain spin does NOT set it (browsing stays
vetoable and disposable).

Lifecycle: replaced by the next committed pick in that stream (server
returns 409 unless `replace=true` — the confirm is enforced, not
cosmetic); cleared when a `watched` event lands for its **(media_type,
item_key)** pair (media_type must match — TMDB movie and TV ids overlap);
clearable explicitly from the card ("clear pick"). Because it's keyed by
stream, a pending movie download and tonight's TV pick coexist.

**Watch-now does NOT auto-log `watched`** (Swamp Roulette marked watched
on click; that both killed the card instantly and recorded films nobody
finished). Tapping ▶ commits the pick, opens the deep link, and the
tonight card gains a prominent "✓ Mark watched" action — tapping that logs
`watched` (which auto-inserts `seen`) and clears the pick. v1.2 auto-log
makes this automatic; until then the card is the reminder.

Every page load gets `current_picks` in `/api/state`: if the active stream
has one, the frontend renders the chosen card — verdict re-probed, progress
watcher remounted (progress is stateless server-side, so resuming is just
polling again). Any device in the household sees the same card.

## Pool system

- Admin creates a pool in Settings, picks its **stream (movie or TV)** and
  source, and supplies the source config (TMDB list ID, Trakt list
  URL/slug, or a file upload for Custom). One active pool per stream; a
  stream with no active pool simply shows "set up a pool" on its wheel.
- Server fetches the list, **enriches every item via TMDB** (runtime or
  episode runtime, seasons, genres, poster, rating) regardless of source,
  using the movie or TV endpoints per the pool's stream, and caches into
  `items`. TMDB is therefore a required credential (free tier, attribution
  in UI footer). Enrichment failures leave nullable fields null — filters
  treat null as "matches".
- **Enrichment is incremental and throttled.** A refresh enriches only
  tmdb_ids not already present in `items` for that media_type (any pool) —
  a 300-item pool costs 300 TMDB calls once, then only deltas. (An item
  deleted by a refresh and re-added later is re-fetched; that delta is
  small and acceptable.)
  Detail calls run through a throttle (≤4 concurrent, small delay) to stay
  inside TMDB rate limits; a partially-enriched refresh completes what it
  can, records per-item failures, and retries stragglers on the next pass
  rather than failing the pool.
- Refresh: manual button + daily job (background task at startup, 24h
  cadence). Refresh diffs by tmdb_id: new items added, removed items
  deleted, event history untouched (it lives on item_key, not items.id).
- Custom import accepts JSON `[{title, year, tmdb_id?}]` or CSV
  `title,year` (RFC-4180: quoted titles with commas must parse) — tmdb_id
  resolved by search (movie or TV per the pool's stream) when absent;
  unresolved rows reported to admin, imported metadata-bare. Rows without
  a tmdb_id are deduped on normalized (title, year) — SQLite's UNIQUE
  treats NULLs as distinct, so the import path enforces this itself.
- The wheel spins over: active pool items − shared seen list (same stream,
  excluded by default; the **"include seen"** filter toggle re-admits them
  for rewatch nights) − active filters. All client-side once `/api/pool`
  is loaded (fast spins, works during API blips).
- **Empty wheel is a state, not an error:** when seen + filters exhaust
  the pool, show "The wheel is empty" with two one-tap fixes — loosen
  filters (reset to defaults) or include seen — and a link to reset-seen
  in settings. Never a blank card or a spinner that lands on nothing.

## API surface

All JSON under `/api`. Non-200 errors carry `{detail}`.

| Endpoint | Purpose |
|---|---|
| `GET  /api/health` | `{ok, version, seerr:bool, radarr:bool, sonarr:bool, media_server:"plex"\|"jellyfin"\|null, pools:{movie:bool, tv:bool}}` |
| `GET  /api/state` | page-load bundle: players, active pool meta per stream, **current_picks**, seen lists, veto availability, history (50), grudges |
| `DELETE /api/pick?stream=` | explicitly clear tonight's pick (set happens server-side inside watch/duel flows) |
| `GET  /api/pool?stream=movie\|tv` | active pool items for that stream (the wheel's dataset) |
| `POST /api/event` | log spun/watched/seen ONLY (player- and stream-attributed); vetoed/requested/duel_won have their own endpoints — other actions rejected 422. A `watched` event also clears a matching current_pick |
| `POST /api/veto` | spend a token; 409 when the player's tokens are exhausted tonight (tokens are cross-stream, N = `veto_tokens`) |
| `POST /api/duel/win` | log duel_won and upsert current_picks — **same 409/`replace=true` contract as /api/watch** (+ optional watched flow follows) |
| `POST /api/reset-seen` | clears seen events only (per stream or all) |
| `GET  /api/status?item_key=&type=&title=&year=` | read-only verdict: `available\|pending\|unrequested\|notfound\|unknown` + deep_link + match confidence. **Two-path:** tmdb-keyed items hit Seerr's direct `/movie/{id}` / `/tv/{id}` lookup (no fuzzy search); title-keyed items fall back to search + match helper |
| `POST /api/watch` | summon: seerr search → status → request if absent; logs `requested`, captures external ids (tmdb/tvdb) from Seerr's response, and **upserts current_picks**. Returns **409 `{pending_pick}`** if the stream already has a pending pick, unless `replace=true` — the replace confirm is server-enforced, not cosmetic. TV requests **Season 1 only** by default (`TV_REQUEST_SEASONS=first\|all` env) |
| `GET  /api/progress?type=&tmdb=&tvdb=&title=&year=` | routes to radarr (movie, by tmdb) or sonarr (tv, by tvdb, falling back to title+year — hence the extra params): `{state, percent, eta, title, landed}` where state ∈ `queued\|downloading\|importing\|done\|searching\|unconfigured\|unknown` (never 5xx on config/conn). TV: percent aggregates the series' queue records; `landed:{ready:3, total:10}` reports imported episodes; `done` = first episode imported (requires an episode-file check, not just the queue) |
| `GET  /api/stats` | scoreboard aggregates (per stream + combined) |
| **Admin** | |
| `GET/PUT /api/connections` | read/update integration settings (keys masked on read); **write endpoints gated by the admin PIN when one is set** |
| `POST /api/connections/{service}/test` | live credential round-trip → `{ok, message}` |
| `GET/POST/DELETE /api/players` | manage players; DELETE **deactivates** (active=0) — events reference players, so hard deletes are never allowed |
| `GET/POST/DELETE /api/pools` | manage pools; `POST /api/pools/{id}/refresh`; `POST /api/pools/{id}/activate` (activates within its stream) |
| `POST /api/pools/import` | custom list file upload |

Status verdict logic (from Swamp Roulette, now two-source): Overseerr
search+match gives request status; MediaServer gives ground-truth library
presence. `available` requires the media server to confirm (or, if the
media server is unconfigured, falls back to Overseerr's availability flag).
For TV, Overseerr's `partially available` maps to `available` — you can
start watching a show that has episodes. Title matching lives in one
shared helper used for both media types and all services: `normalize` =
lowercase, strip diacritics, collapse whitespace, drop punctuation (do
NOT drop leading articles — year anchoring disambiguates); prefer exact
normalized title+year, ±1 year fallback, and report exact-vs-fuzzy so
callers can surface confidence.

## Frontend (React + Vite, TypeScript)

Single-page PWA. Build output served by FastAPI; no separate web server.
State via React Query (server state) + small Zustand store (session state:
who am I, blind mode, filters). No router needed beyond view state in v1.

**Views/components:**
- **First-run onboarding** — when no players exist, a linear, skippable
  wizard replaces the wheel: (1) add players, (2) connect TMDB + Seerr
  (Test buttons inline), (3) pick a pool source and import it, (4) first
  spin. Each step usable independently later from Settings; the wizard is
  just the ordered path. An *arr user's opinion forms in five minutes —
  this is those five minutes.
- **Identity gate** — first visit: "Who's spinning?" grid of player chips;
  stored per-device (localStorage); switchable from header.
- **Stream toggle** — Movies / TV switch in the header. Everything below
  it (wheel, filters, pick card, history views) is scoped to the selected
  stream; the choice persists per device. Duels happen within one stream.
- **The wheel** — big spin button, filter drawer (runtime dual-handle
  slider with School Night / Committed presets — 40–210+ min for movies,
  episode-runtime scaled 15–90+ for TV; genre chips; decade; **include
  seen** toggle, off by default), blind-mode toggle.
- **The spin moment (this is the product — design it, don't default it):**
  tapping Spin runs a poster-shuffle roulette ~2.5s — candidates flick
  past fast, decelerate with easing, land with a near-miss overshoot and
  settle. Haptic tick on supporting mobile browsers, one soft landing
  thunk if sound is ever added (off by default). `prefers-reduced-motion`
  collapses the whole sequence to a 300ms crossfade. The winner is chosen
  BEFORE the animation starts (animation is theater, not selection) so the
  result is never racy. Re-spins (veto, duel slot) reuse the same beat,
  shortened (~1.2s).
- **Pick card** — poster, title (masked when blind: fixed-width ▓ mask),
  year/runtime/rating/rank (TV adds season count), availability flag,
  actions: Veto (token-aware, sass when spent), Seen it, Let's watch
  (verdict-driven: ▶ Watch now with deep link / ⏳ + progress bar /
  🎯 Summon / ⚠ manual fallback). Blind reveal: first tap reveals, second
  tap acts.
- **Tonight card** — the committed pick, restored from `current_picks` on
  every page load: same card, verdict re-probed, progress watcher
  remounted mid-download. Carries the **"✓ Mark watched"** action (watch-
  now never auto-logs watched — see Tonight's pick lifecycle). Shown
  pinned above the wheel until marked watched, replaced, or cleared
  ("clear pick" affordance, with confirm). Spinning again never silently
  kills it — the wheel spins *beneath* tonight's card, and committing a
  new pick asks before replacing (server-enforced 409/replace).
- **Duel** — **single-device, pass-the-phone in v1** (duel state is
  client-local; realtime multi-device duels are v2, they need websockets).
  Starting a duel with 3+ configured players opens a two-player picker
  (defaults: current identity + most recently active other player).
  **Layout:** two 2:3 posters side by side (~44vw each), VS divider,
  explicit **crown button under each card** (never tap-the-poster — that
  collides with tap-for-details expectations), fate button centered
  below. Each player spins their slot; per-slot Seen-it re-spins that
  slot only; Rematch re-runs both; crown a winner or "fate decides" — the
  fate flip gets its own animation beat (~1.5s of genuine suspense, not
  an instant result). Winner logs `duel_won` and proceeds through the
  normal pick flow. Vetoes disabled inside duels (the duel IS the
  negotiation).
- **Progress watcher** — mounts on any card whose film is in-flight; polls
  `/api/progress` every 5s; hard cap 180 polls, resumed by tab focus or
  reload (the tonight card remounts it); pauses on `document.hidden`;
  exactly one active watcher (React lifecycle handles teardown — this was
  manual discipline in Swamp Roulette, free in React). **Stuck states get
  honest copy:** after ~10 min continuously in `searching`, soften to
  "Still hunting — this one might need manual help" with a link to the
  item in Seerr; on poll-cap expiry, "Download's still going — check back"
  rather than a frozen bar.
- **History & grudges** — collapsible: recent watches/requests (who, what,
  when) and the grudge list with culprit counts.
- **Scoreboard** — per-player watched/requested/spins/vetoes/duel wins,
  seen total, top grudges. Lazy-loaded on first open. Crowned with
  computed **flavor titles** ("Most Vetoed", "Duel Champion", "The
  Summoner") — cheap lines from the strings file, and the screenshot
  people share.
- **Settings (admin)** — players CRUD, pools CRUD (source picker, config
  fields per source, refresh/activate, import upload), and **Connections**:
  one card per integration with URL/API-key fields, a Test button
  (`POST /api/connections/{service}/test` round-trips the credential), and
  saved-state indicators — the *arr setup flow users already know.
  Fields seeded from env show a "set by environment" badge and are
  read-only while the env var is present.

**PWA:** manifest (name Decidarr, standalone, 192/512 icons **plus a
dedicated maskable variant** — the standard mark's pointer touches the
edge and Android's mask would crop it; the maskable icon holds the mark
inside the 80% safe zone on full-bleed ink), apple-touch-icon (180px),
multi-size favicon.ico, og-image for social embeds. Service worker
cache-first for the shell only, network for /api. Installable on
iOS + Android; not attempting offline data. Two footguns handled
explicitly: (1) `URL_BASE` must thread through manifest `start_url`/
`scope`, the service-worker scope, and the frontend's API base — test the
subpath deploy, it's where PWAs quietly break; (2) shell updates use
skipWaiting + a "new version — reload?" toast so a cached shell never
pins users to a stale build.

## UX & visual system

**Screen anatomy (phone-first, explicit):** header (identity chip left,
Movies/TV segmented toggle center, filter button with **active-count
badge** — "Filters · 2" — right) → tonight card when present → the stage
(pick card or idle wheel) → **Spin button fixed in the bottom thumb arc**,
full-width minus gutters, always reachable one-handed. Below-stage content
never pushes Spin off-screen.

**Navigation:** slim bottom bar, four items — Spin · History · Board ·
Settings. No hamburger, no junk-drawer collapsibles. Duel launches from
the stage (secondary button beside Spin).

**Design tokens (numbers, not adjectives)** — one CSS-variables file:
- Palette: ink `#10141a` · panel `#1a212b` · line `#2a3442` · gold
  `#d4a943` (primary/action) · green `#3fae6a` (success/available) ·
  cream `#e8e0cc` (text) · dim `#7d8899` (captions — verify AA on ink,
  darken ink rather than lighten dim if it fails)
- Spacing scale: 4/8/12/16/24/32 · Radii: 8 (chips), 16 (cards) ·
  Progress track: 6px
- Type: **JetBrains Mono** for captions, stats, labels, status lines (the
  noir-terminal voice); **Inter/system** for body and titles. Nothing
  else. Rem-based, honors OS font scaling.

**Iconography & brand:** drawn icons only (Lucide, 1.5px stroke) for all
actions — **no functional emojis in UI chrome** (they render differently
per platform and can't be styled); personality lives in copy, which lives
in the strings file. The brand motifs recur: the reel mark's **pointer**
is the UI wheel pointer, the **spinning reel** is the loading spinner,
the **green pocket** marks available items.

**Posters are the graphics:** locked 2:3 aspect boxes (zero layout
shift), blur-up loading from TMDB's smallest size, gradient scrim at the
card base for text legibility, skeleton shimmer for every loading state.

**Motion system:** one easing family, three durations — 150ms micro
(chips, toggles), 300ms transitions (cards, sheets, toasts), 2500ms spin
(1200ms re-spins, 1500ms fate flip). Toasts slide up above the Spin
button. Everything honors `prefers-reduced-motion` (spin collapses to a
300ms crossfade).

**Accessibility:** AA contrast (4.5:1) mandated for all text; visible
gold focus rings; spin results announced via `aria-live` (animation is
theater — assistive tech gets the result immediately); color never the
sole signal (available = green + check icon); touch targets ≥44px with
destructive/costly actions (Veto) spatially separated from primary ones.

**Veto undo:** vetoing shows a 5-second "Vetoed. Undo?" toast before the
event POSTs — one-tap spending of your only nightly token deserves a
grace window. Undo restores the pick in place.

**Responsive strategy:** designed at ≤430px portrait; tablet/desktop get
the same single column, max-width 520px, centered on ink. TVs are not a
v1 target.

**Copy voice:** keeps Swamp Roulette's personality (sass on spent vetoes,
flavor in status lines) minus swamp references; all player-facing strings
in one file so the voice tunes in one place. The noir theme is the only
v1 theme, but nothing hardcodes it — everything reads from tokens.

## Configuration

Setup is designed to feel *arr-native. Integrations are configured
**in-app** at Settings → Connections — one card per service, URL + API key
fields, and a **Test** button that round-trips the credential live and
shows a green check or the upstream error, exactly the flow *arr users
know from wiring Radarr to Prowlarr. Values persist in the `settings`
table, so connecting a service never requires a container restart.

Environment variables with the names below **seed** the corresponding
settings at first startup and **override** them when set — so compose-first
users can define everything in `compose.yaml` and never open the UI, and
docs/examples stay copy-pasteable:

```
TZ=Pacific/Auckland                    # veto-day boundary
DB_PATH=/data/decidarr.db
URL_BASE=                              # optional: serve under a subpath behind a reverse proxy
SEERR_URL / SEERR_API_KEY              # Overseerr or Jellyseerr (required for summon)
RADARR_URL / RADARR_API_KEY            # optional: movie progress bar
SONARR_URL / SONARR_API_KEY            # optional: tv progress bar
TV_REQUEST_SEASONS=first|all           # default first: summon requests Season 1
MEDIA_SERVER=plex|jellyfin             # optional: availability + deep links
PLEX_URL / PLEX_TOKEN                  # when MEDIA_SERVER=plex
JELLYFIN_URL / JELLYFIN_API_KEY        # when MEDIA_SERVER=jellyfin
TMDB_API_KEY                           # required: pool enrichment
TRAKT_CLIENT_ID                        # optional: trakt pools
```

Everything domain-level (players, pools, filters) also lives in SQLite via
the Settings UI — no container restarts to change who plays or what's in
the wheel. Two notable settings knobs: **`veto_tokens`** (per player per
night, default 1) and **`admin_pin`** (optional; when set, all
settings-write endpoints — connections, players, pools — require it via an
`X-Admin-Pin` header, and the Settings UI prompts once per session).
Game endpoints are never PIN-gated; the reverse proxy remains the outer
lock, the PIN just keeps houseguests out of the wiring.

Degradation matrix (each row independent):

| Missing | Effect |
|---|---|
| SEERR_* | Summon button → "configure Overseerr" hint; spin/veto/duel unaffected |
| RADARR_* | No movie progress bar; static "on its way" text |
| SONARR_* | No TV progress bar; static "on its way" text |
| MEDIA_SERVER creds | Verdicts fall back to Overseerr's availability; no deep links |
| TRAKT_CLIENT_ID | Trakt source hidden in pool picker |
| TMDB_API_KEY | Blocking at startup for pool features; health flags it |

## Error handling principles

1. Optional-integration failures are states, not exceptions (`unknown`,
   `unconfigured`) — the UI hides the affected affordance and nothing else.
2. Veto races → 409 → client refreshes state; never crashes the flow.
3. Pool refresh failures keep the previous cache and surface a settings-
   panel warning with the upstream error.
4. All writes are short single transactions; SQLite WAL.
5. Frontend fetch failures: spin still works (pool is client-cached);
   writes fail loudly (toast), never silently.

## Testing

- **pytest + httpx MockTransport** per integration module: seerr verdicts
  (all five, movie + tv incl. partially-available mapping), radarr progress
  state machine (queue mapping, percent, eta normalization,
  importing/done/searching/unknown, zero-size), sonarr progress (multi-
  episode aggregation, weighted percent, episode-count label), plex and
  jellyfin availability (movie + show found/absent/error), tmdb + trakt
  pool fetch and enrichment shaping (both streams), custom import parsing
  (JSON, CSV, unresolved rows).
- **API tests:** event validation, veto day-boundary logic (TZ-aware,
  cross-stream), derived queries (seen/grudges/history/stats incl.
  duel_won, stream scoping, configurable veto_tokens), pool CRUD +
  one-active-per-stream semantics, health flags, progress route never-5xx
  and correct radarr/sonarr routing (tvdb for tv, tmdb for movies, title
  fallback, unknown when unresolvable), current_picks lifecycle (upsert on
  watch/duel-win with external-id capture, cleared on watched, explicit
  clear, per-stream independence, present in /api/state, **409 on pending
  pick without replace=true**), admin-PIN gating (blocks settings writes
  when set, never blocks game endpoints), match-ladder confidence
  (provider-id exact vs fuzzy), incremental enrichment (cached ids not
  refetched, throttle honored, partial failure retried), duel/win honors
  the same 409/replace contract as watch, watched event clears only the
  matching (media_type, item_key) pick, CSV import with quoted
  comma-containing titles, TV `landed` counts and episode-file done check.
- **Frontend:** Vitest for pure logic (filtering, wheel exclusion, verdict
  → button mapping, blind mask/reveal state machine, veto undo grace —
  POST deferred 5s and cancelled on undo); Playwright smoke
  (spin → pick → veto → duel → summon happy path against a mocked API);
  an axe-core accessibility pass on the main views (AA contrast, focus
  order, aria-live spin announcement).
- Manual smoke checklist for the integration seams a mock can't prove:
  real Plex + real Jellyfin availability (movie and show), a real movie
  summon landing in Plex, a real TV summon (Season 1) landing via Sonarr,
  progress bars advancing on live downloads in both streams, **summon then
  hard-refresh mid-download → tonight card and progress bar restored**
  (and visible from a second device), PWA install on iOS/Android.

## Packaging & deploy

- Multi-stage Dockerfile: node builds the frontend → python slim runtime
  copies backend + dist. Target image < 200MB.
- **Single-process by design:** uvicorn runs one worker. The daily
  pool-refresh task and SQLite both assume a single process — document
  this and don't offer a workers knob (a two-worker deploy would
  double-run the refresher and fight over the DB).
- `compose.yaml` example in repo with every env var commented.
- `/api/health` suitable for container HEALTHCHECK and Homarr/Homepage
  widgets.
- GitHub Actions: lint + test on PR; image build to GHCR + Docker Hub
  (`decidarr/decidarr`) on tag.
- README quick-start: compose up, open :5454, add players, pick a pool
  source, spin.

## v1.2 (committed follow-up): auto-log from playback

A background poller watches the media server's watch history and inserts
`watched` events automatically when a pool item is played — no more
tapping "watched" after the credits. Gets its own design cycle (polling
cadence, dedupe, completion threshold), but v1 must leave the door open:

- Map media-server users → Decidarr players: `players` gains nullable
  `plex_user` / `jellyfin_user` columns **in the v1 schema** (unused until
  v1.2; avoids the table rebuild).
- Auto-logged events need attribution: `events` gains a `source` column in
  v1 (`CHECK(source IN ('user','auto'))`, default `'user'`) so v1.2 never
  touches the CHECK constraint.
- The MediaServer interface reserves a `recent_watches(client, since)`
  method (unimplemented in v1) so v1.2 is additive, not structural.

## v2 candidates (parking lot, not commitments)

Letterboxd/mdblist sources · multiple simultaneous pools per stream with
per-spin pool picker · realtime multi-device duels (websockets) ·
episode-level TV tracking ("what are we up to?") · Emby · per-player taste
weighting · Decidarr's own API key for dashboard widgets ·
Discord/Telegram night-summary bot · awesome-arr listing once installable.
