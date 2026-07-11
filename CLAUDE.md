# Decidarr

The watch-night decision engine for the *arr stack. Spin a wheel over a
curated pool (Movies or TV, never mixed); the pick is availability-checked
against Plex/Jellyfin; one tap summons it via Overseerr/Jellyseerr with a
live Radarr/Sonarr download progress bar. Social layer: veto tokens, duels,
blind picks, grudge list, scoreboard.

**Read `docs/specs/2026-07-11-decidarr-v1-design.md` before non-trivial
changes.** It is the authoritative design — reviewed three times (CTO,
engineering, UX) — and every decision below is justified there.

## Heritage & context

- Clean-room rebuild of "Swamp Roulette", a private two-player picker in
  production on the owner's Synology (MudBox). No code was ported; the
  design lessons were.
- Public repo: github.com/decidarr/decidarr (GPL-3.0). Docker Hub namespace
  `decidarr` is claimed. Brand assets live in `assets/` (Reel Roulette
  mark; palette: ink #10141a, gold #d4a943, green #3fae6a, cream #e8e0cc).

## Architecture (one container, port 5454)

- `backend/` — FastAPI + SQLite (WAL). `app.py` routes; `db.py` schema +
  derived queries; one module per external service (`seerr.py`,
  `radarr.py`, `sonarr.py`, `media/plex.py`, `media/jellyfin.py`,
  `pools/{tmdb,trakt,custom}.py`).
- `frontend/` — React 18 + Vite + TS. React Query (server state) + Zustand
  (session). Design tokens in `src/tokens.css`; ALL player-facing copy in
  `src/strings.ts`.
- Frontend build is served by FastAPI from `static/` (Docker copies
  `frontend/dist` there; `STATIC_DIR` env overrides for dev).

## Non-negotiable invariants

1. **Optional integrations never raise for config/connectivity.** They
   return sentinel states (`unknown`, `unconfigured`) the UI hides. The
   progress route must never 5xx for these reasons.
2. **Everything social derives from `events`** — never add mutable state
   tables for things countable from events. The only mutable state is
   `current_picks` (tonight's pick, one row per stream) and `settings`.
3. **Identity is (media_type, item_key)** — TMDB movie and TV id spaces
   overlap; never match on item_key alone.
4. **Sonarr speaks TVDB, Radarr speaks TMDB.** TV progress looks up by
   tvdb_id (captured from Seerr at summon), falls back to exact title+year,
   returns `unknown` rather than guessing.
5. **TV is watchable-first**: `done` = first episode of the requested
   season imported, with `landed:{ready,total}` for the rest.
6. **Committing a pick over a pending one requires `replace=true`** (409
   `pending_pick` otherwise) — enforced server-side in BOTH /api/watch and
   /api/duel/win.
7. **Watch-now does NOT auto-log `watched`** — the tonight card's "Mark
   watched" does (and that clears the pick + auto-inserts `seen`).
8. **Single uvicorn worker.** SQLite + the daily refresh task assume one
   process. Do not add a workers knob.
9. **Spin animation is theater** — the winner is chosen before the
   animation starts. Honor `prefers-reduced-motion`.
10. **No functional emojis in UI chrome** — Lucide icons; personality lives
    in `strings.ts`.
11. Credentials resolve env-first, then settings table, at call time
    (`config.resolve`). Env-set fields are read-only in the UI.
12. Admin PIN (when set) gates settings writes only — never game endpoints.

## Commands

```bash
# backend tests (must stay green)
cd backend && python -m pytest tests -q

# backend dev server
cd backend && uvicorn app:app --port 5454 --reload

# frontend
cd frontend && npm run dev     # proxies /api to :5454
cd frontend && npx vitest run  # logic tests
cd frontend && npm run build   # tsc + vite

# full image
docker build -t decidarr .
```

## Testing conventions

- Integration modules are tested with `httpx.MockTransport` + injected
  clients and `asyncio.run` (no pytest-asyncio).
- API tests use FastAPI's TestClient with a tmp_path DB per test
  (see `tests/conftest.py`).
- When touching pick/veto/event logic, run the whole backend suite — the
  contracts (409/replace, cross-stream tokens, pick clearing) are the most
  regression-prone surface.

## Roadmap context

- **v1.2 (committed):** auto-log watched from Plex/Jellyfin playback. The
  schema already reserves `players.plex_user/jellyfin_user`,
  `events.source ('user'|'auto')`, and the MediaServer
  `recent_watches(client, since)` method — v1.2 must be additive only.
- v2 parking lot lives at the bottom of the design spec.
- Deferred knowingly: Playwright smoke harness, axe-core CI pass, real
  Plex/Jellyfin/Seerr round-trip verification (mock-tested only until the
  owner's MudBox smoke).
