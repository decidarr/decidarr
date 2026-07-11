import asyncio
import json
import os
import sqlite3
from contextlib import asynccontextmanager, closing

from fastapi import (APIRouter, Depends, FastAPI, File, Form, Header,
                     HTTPException, UploadFile)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import autolog
import config
import db
import radarr
import seerr
import sonarr
from media import get_backend
from pools import custom as custom_pool, refresh as pool_refresh, tmdb as tmdb_pool

VERSION = "1.2.0"


async def _daily_refresh():
    while True:
        await asyncio.sleep(86400)
        with closing(db.get_conn()) as conn:
            ids = [r["id"] for r in
                   conn.execute("SELECT id FROM pools WHERE active=1")]
        for pool_id in ids:
            try:
                await pool_refresh.refresh_pool(pool_id)
            except Exception:
                pass  # next cycle retries; refresh already never-raises for fetch


async def _autolog_loop():
    while True:
        # Re-read each cycle so a settings change applies without restart.
        interval = int(config.resolve("autolog_interval") or autolog.DEFAULT_INTERVAL)
        await asyncio.sleep(interval)
        try:
            await autolog.poll_once()
        except Exception:
            pass  # a poll bug degrades auto-log, never the app


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    config.seed_settings()
    tasks = [asyncio.create_task(_daily_refresh()),
             asyncio.create_task(_autolog_loop())]
    yield
    for task in tasks:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(lifespan=lifespan)

URL_BASE = (os.environ.get("URL_BASE") or "").rstrip("/")  # "" or "/decidarr"
api = APIRouter()


@api.get("/api/health")
def health():
    with closing(db.get_conn()) as conn:
        pool_flags = {
            mt: bool(conn.execute(
                "SELECT 1 FROM pools WHERE media_type=? AND active=1",
                (mt,)).fetchone())
            for mt in ("movie", "tv")}
    return {
        "ok": True,
        "version": VERSION,
        "seerr": bool(config.resolve("seerr_url") and config.resolve("seerr_api_key")),
        "radarr": bool(config.resolve("radarr_url") and config.resolve("radarr_api_key")),
        "sonarr": bool(config.resolve("sonarr_url") and config.resolve("sonarr_api_key")),
        "media_server": config.resolve("media_server"),
        "pools": pool_flags,
        "autolog": bool(autolog.enabled() and (b := get_backend())
                        and b.configured()),
    }


@api.get("/api/state")
def state():
    with closing(db.get_conn()) as conn:
        players = [dict(r) for r in conn.execute(
            "SELECT id, name, emoji FROM players WHERE active=1 ORDER BY id")]
        pools = {}
        for mt in ("movie", "tv"):
            row = conn.execute(
                "SELECT id, name, source, refreshed_at FROM pools"
                " WHERE media_type=? AND active=1", (mt,)).fetchone()
            pools[mt] = dict(row) if row else None
        picks = {r["media_type"]: dict(r) for r in conn.execute(
            "SELECT * FROM current_picks")}
        tokens = int(config.resolve("veto_tokens") or 1)
        tz = config.resolve("tz") or "UTC"
        vetoes = {p["id"]: max(0, tokens - db.vetoes_used_today(conn, p["id"], tz))
                  for p in players}
        out = {
            "players": players,
            "pools": pools,
            "current_picks": picks,
            "seen": {mt: sorted(db.seen_keys(conn, mt)) for mt in ("movie", "tv")},
            "vetoes": vetoes,
            "veto_tokens": tokens,
            "history": db.history(conn, 50),
            "grudges": db.grudges(conn),
        }
    return out


@api.get("/api/stats")
def stats():
    with closing(db.get_conn()) as conn:
        result = db.stats(conn)
    return result


def require_admin(x_admin_pin: str | None = Header(None)):
    pin = config.get_setting("admin_pin")
    if pin and x_admin_pin != pin:
        raise HTTPException(401, "admin_pin_required")


class PlayerIn(BaseModel):
    name: str
    emoji: str | None = None


@api.get("/api/players")
def list_players():
    with closing(db.get_conn()) as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT id, name, emoji, active, plex_user, jellyfin_user"
            " FROM players ORDER BY id")]
    return rows


@api.post("/api/players", status_code=201, dependencies=[Depends(require_admin)])
def create_player(body: PlayerIn):
    with closing(db.get_conn()) as conn:
        dup = conn.execute("SELECT 1 FROM players WHERE name=?",
                           (body.name,)).fetchone()
        if dup:
            raise HTTPException(409, "player_exists")
        try:
            cur = conn.execute("INSERT INTO players(name, emoji) VALUES (?,?)",
                               (body.name, body.emoji))
            conn.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(409, "player_exists")
        pid = cur.lastrowid
    return {"id": pid, "name": body.name, "emoji": body.emoji, "active": 1}


@api.delete("/api/players/{player_id}", dependencies=[Depends(require_admin)])
def deactivate_player(player_id: int):
    with closing(db.get_conn()) as conn:
        conn.execute("UPDATE players SET active=0 WHERE id=?", (player_id,))
        conn.commit()
    return {"ok": True}


class PlayerPatch(BaseModel):
    plex_user: str | None = None
    jellyfin_user: str | None = None


@api.patch("/api/players/{player_id}", dependencies=[Depends(require_admin)])
def patch_player(player_id: int, body: PlayerPatch):
    fields = body.model_dump(exclude_unset=True)   # omitted ≠ explicit null
    with closing(db.get_conn()) as conn:
        if not conn.execute("SELECT 1 FROM players WHERE id=?",
                            (player_id,)).fetchone():
            raise HTTPException(404, "player_not_found")
        if fields:
            # keys come from the fixed Pydantic model — not injectable
            sets = ", ".join(f"{k}=?" for k in fields)
            conn.execute(f"UPDATE players SET {sets} WHERE id=?",
                         (*fields.values(), player_id))
            conn.commit()
        row = conn.execute(
            "SELECT id, name, emoji, active, plex_user, jellyfin_user"
            " FROM players WHERE id=?", (player_id,)).fetchone()
    return dict(row)


class EventIn(BaseModel):
    player: int
    media_type: str
    item_key: str
    title: str
    year: int | None = None
    action: str


@api.post("/api/event")
def post_event(body: EventIn):
    if body.action not in ("spun", "watched", "seen"):
        raise HTTPException(422, "action_not_allowed")
    if body.media_type not in ("movie", "tv"):
        raise HTTPException(422, "bad_media_type")
    with closing(db.get_conn()) as conn:
        db.log_event(conn, body.player, body.media_type, body.item_key,
                     body.title, body.year, body.action)
    return {"ok": True}


class VetoIn(BaseModel):
    player: int
    media_type: str
    item_key: str
    title: str
    year: int | None = None


@api.post("/api/veto")
def post_veto(body: VetoIn):
    if body.media_type not in ("movie", "tv"):
        raise HTTPException(422, "bad_media_type")
    tokens = int(config.resolve("veto_tokens") or 1)
    tz = config.resolve("tz") or "UTC"
    with closing(db.get_conn()) as conn:
        used = db.vetoes_used_today(conn, body.player, tz)
        if used >= tokens:
            raise HTTPException(409, "no_tokens")
        db.log_event(conn, body.player, body.media_type, body.item_key,
                     body.title, body.year, "vetoed")
    return {"ok": True, "remaining": tokens - used - 1}


class ResetSeenIn(BaseModel):
    stream: str | None = None


@api.post("/api/reset-seen", dependencies=[Depends(require_admin)])
def reset_seen(body: ResetSeenIn):
    with closing(db.get_conn()) as conn:
        if body.stream:
            cur = conn.execute(
                "DELETE FROM events WHERE action='seen' AND media_type=?",
                (body.stream,))
        else:
            cur = conn.execute("DELETE FROM events WHERE action='seen'")
        conn.commit()
        deleted = cur.rowcount
    return {"ok": True, "deleted": deleted}


@api.delete("/api/pick")
def clear_pick(stream: str):
    if stream not in ("movie", "tv"):
        raise HTTPException(422, "bad_stream")
    with closing(db.get_conn()) as conn:
        conn.execute("DELETE FROM current_picks WHERE media_type=?", (stream,))
        conn.commit()
    return {"ok": True}


class DuelWinIn(BaseModel):
    player: int
    media_type: str
    item_key: str
    title: str
    year: int | None = None
    tmdb_id: int | None = None
    replace: bool = False


@api.post("/api/duel/win")
def duel_win(body: DuelWinIn):
    if body.media_type not in ("movie", "tv"):
        raise HTTPException(422, "bad_media_type")
    with closing(db.get_conn()) as conn:
        try:
            db.upsert_pick(conn, body.media_type, body.item_key, body.title,
                           body.year, body.tmdb_id, None, body.player,
                           body.replace)
        except db.PendingPickError:
            raise HTTPException(409, "pending_pick")
        db.log_event(conn, body.player, body.media_type, body.item_key,
                     body.title, body.year, "duel_won")
    return {"ok": True}


async def _seerr_status(item_key, media_type, title, year):
    if not seerr.configured():
        return {"verdict": "unknown", "tmdb_id": None, "tvdb_id": None,
                "confidence": "none"}
    async with seerr.make_client() as c:
        if item_key.startswith("tmdb:"):
            return await seerr.status_direct(c, int(item_key[5:]), media_type)
        return await seerr.status_by_title(c, title, year, media_type)


async def _media_overlay(media_type, title, year, tmdb_id):
    backend = get_backend()
    if not backend or not backend.configured():
        return None
    async with backend.make_client() as c:
        verdict, conf, native_id = await backend.availability(
            c, {"tmdb_id": tmdb_id, "title": title, "year": year}, media_type)
    return {"verdict": verdict, "confidence": conf,
            "deep_link": backend.deep_link(native_id) if native_id else None}


@api.get("/api/status")
async def status(item_key: str, type: str, title: str, year: int | None = None):
    if type not in ("movie", "tv"):
        raise HTTPException(422, "bad_media_type")
    s = await _seerr_status(item_key, type, title, year)
    tmdb_id = s.get("tmdb_id") or (
        int(item_key[5:]) if item_key.startswith("tmdb:") else None)
    overlay = await _media_overlay(type, title, year, tmdb_id)
    if overlay and overlay["verdict"] == "available":
        return {"verdict": "available", "deep_link": overlay["deep_link"],
                "confidence": overlay["confidence"]}
    return {"verdict": s["verdict"], "deep_link": None,
            "confidence": s["confidence"]}


class WatchIn(BaseModel):
    player: int
    media_type: str
    item_key: str
    title: str
    year: int | None = None
    tmdb_id: int | None = None
    replace: bool = False


@api.post("/api/watch")
async def watch(body: WatchIn):
    if body.media_type not in ("movie", "tv"):
        raise HTTPException(422, "bad_media_type")
    if not seerr.configured():
        raise HTTPException(503, "seerr_unconfigured")
    s = await _seerr_status(body.item_key, body.media_type, body.title, body.year)
    tmdb_id = body.tmdb_id or s.get("tmdb_id")
    tvdb_id = s.get("tvdb_id")
    # raw Seerr verdict on purpose: Summon is only invoked when /api/status
    # wasn't 'available', so we don't consult the media-server overlay here.
    if s["verdict"] == "available":
        with closing(db.get_conn()) as conn:
            try:
                db.upsert_pick(conn, body.media_type, body.item_key, body.title,
                               body.year, tmdb_id, tvdb_id, body.player,
                               body.replace)
            except db.PendingPickError:
                raise HTTPException(409, "pending_pick")
        overlay = await _media_overlay(body.media_type, body.title, body.year,
                                       tmdb_id)
        return {"verdict": "available",
                "deep_link": overlay["deep_link"] if overlay else None}
    # not available -> request it (pick committed only if request succeeds,
    # but the 409 check must come FIRST so we never request then discard)
    with closing(db.get_conn()) as conn:
        row = conn.execute(
            "SELECT item_key FROM current_picks WHERE media_type=?",
            (body.media_type,)).fetchone()
        if row and row["item_key"] != body.item_key and not body.replace:
            raise HTTPException(409, "pending_pick")
        seasons = config.resolve("tv_request_seasons") or "first"
        async with seerr.make_client() as c:
            result = await seerr.request(c, tmdb_id, body.media_type, seasons)
        if not result["ok"]:
            raise HTTPException(502, "request_failed")
        db.upsert_pick(conn, body.media_type, body.item_key, body.title,
                       body.year, result["tmdb_id"], result["tvdb_id"],
                       body.player, True)
        db.log_event(conn, body.player, body.media_type, body.item_key,
                     body.title, body.year, "requested")
    return {"verdict": "pending", "requested": True}


@api.get("/api/progress")
async def progress(type: str, tmdb: int | None = None, tvdb: int | None = None,
                   title: str | None = None, year: int | None = None):
    if type not in ("movie", "tv"):
        raise HTTPException(422, "bad_media_type")
    base = {"state": "unconfigured", "percent": 0, "eta": None, "title": None}
    if type == "movie":
        if not radarr.configured() or tmdb is None:
            return base
        async with radarr.make_client() as c:
            return await radarr.progress(c, tmdb)
    if not sonarr.configured():
        return {**base, "landed": None}
    async with sonarr.make_client() as c:
        return await sonarr.progress(c, tvdb, title, year)


class PoolIn(BaseModel):
    name: str
    media_type: str
    source: str
    config: dict


@api.get("/api/pools")
def list_pools():
    with closing(db.get_conn()) as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT p.*, (SELECT COUNT(*) FROM items i WHERE i.pool_id=p.id)"
            " AS item_count FROM pools p ORDER BY p.id")]
    return rows


@api.post("/api/pools", status_code=201, dependencies=[Depends(require_admin)])
def create_pool(body: PoolIn):
    if body.media_type not in ("movie", "tv") or \
            body.source not in ("custom", "tmdb", "trakt"):
        raise HTTPException(422, "bad_pool")
    if body.source == "trakt" and not config.resolve("trakt_client_id"):
        raise HTTPException(422, "trakt_unconfigured")
    with closing(db.get_conn()) as conn:
        cur = conn.execute(
            "INSERT INTO pools(name, media_type, source, config) VALUES (?,?,?,?)",
            (body.name, body.media_type, body.source, json.dumps(body.config)))
        conn.commit()
        pool_id = cur.lastrowid
    return {"id": pool_id}


@api.delete("/api/pools/{pool_id}", dependencies=[Depends(require_admin)])
def delete_pool(pool_id: int):
    with closing(db.get_conn()) as conn:
        conn.execute("DELETE FROM items WHERE pool_id=?", (pool_id,))
        conn.execute("DELETE FROM pools WHERE id=?", (pool_id,))
        conn.commit()
    return {"ok": True}


@api.post("/api/pools/{pool_id}/activate", dependencies=[Depends(require_admin)])
def activate_pool(pool_id: int):
    with closing(db.get_conn()) as conn:
        row = conn.execute("SELECT media_type FROM pools WHERE id=?",
                           (pool_id,)).fetchone()
        if not row:
            raise HTTPException(404, "pool_not_found")
        conn.execute("UPDATE pools SET active=0 WHERE media_type=?",
                     (row["media_type"],))
        conn.execute("UPDATE pools SET active=1 WHERE id=?", (pool_id,))
        conn.commit()
    return {"ok": True}


@api.post("/api/pools/{pool_id}/refresh", dependencies=[Depends(require_admin)])
async def refresh_pool_route(pool_id: int):
    return await pool_refresh.refresh_pool(pool_id)


@api.post("/api/pools/import", dependencies=[Depends(require_admin)])
async def import_pool(pool_id: int = Form(...), file: UploadFile = File(...)):
    with closing(db.get_conn()) as conn:
        pool = conn.execute("SELECT * FROM pools WHERE id=?",
                            (pool_id,)).fetchone()
        if not pool:
            raise HTTPException(404, "pool_not_found")
        try:
            rows = custom_pool.parse(file.filename or "list.csv",
                                     await file.read())
        except ValueError:
            raise HTTPException(422, "bad_format")
        unresolved = []
        async with tmdb_pool.make_client() as client:
            for r in rows:
                if not r.get("tmdb_id"):
                    r["tmdb_id"] = await tmdb_pool.search(
                        client, r["title"], r.get("year"), pool["media_type"])
                    if not r["tmdb_id"]:
                        unresolved.append(r["title"])
        # dedupe NULL-tmdb rows on normalized (title, year) — UNIQUE won't
        seen_keys_, deduped = set(), []
        for r in rows:
            k = ("id", r["tmdb_id"]) if r["tmdb_id"] else \
                ("t", db.normalize(r["title"]), r.get("year"))
            if k in seen_keys_:
                continue
            seen_keys_.add(k)
            deduped.append(r)
        cfg = json.loads(pool["config"])
        cfg["items"] = deduped
        conn.execute("UPDATE pools SET config=? WHERE id=?",
                     (json.dumps(cfg), pool_id))
        conn.commit()
    await pool_refresh.refresh_pool(pool_id)
    return {"imported": len(deduped), "unresolved": unresolved}


@api.get("/api/pool")
def get_pool(stream: str):
    with closing(db.get_conn()) as conn:
        pool = conn.execute(
            "SELECT id FROM pools WHERE media_type=? AND active=1",
            (stream,)).fetchone()
        if not pool:
            return []
        items = []
        for r in conn.execute(
                "SELECT * FROM items WHERE pool_id=? ORDER BY rank",
                (pool["id"],)):
            d = dict(r)
            d["genres"] = json.loads(d["genres"]) if d["genres"] else []
            d["item_key"] = db.item_key(d["tmdb_id"], d["title"], d["year"])
            items.append(d)
    return items


SECRET_KEYS = {k for k in config.SETTING_ENV if
               k.endswith("_api_key") or k.endswith("_token")} | {"admin_pin"}
CONNECTION_KEYS = set(config.SETTING_ENV) | {"veto_tokens", "admin_pin"}


@api.get("/api/connections")
def get_connections():
    out = {}
    for key in sorted(CONNECTION_KEYS):
        if key == "admin_pin":
            # never return the PIN value (even partially masked) on this
            # ungated read route — only whether one is set.
            out[key] = {"value": None, "set": bool(config.get_setting(key)),
                        "masked": True, "env": config.is_env_set(key)}
            continue
        val = config.resolve(key) if key in config.SETTING_ENV \
            else config.get_setting(key)
        masked = key in SECRET_KEYS
        if val and masked:
            val = ("••••" + val[-2:]) if len(val) > 2 else "••••"
        out[key] = {"value": val, "masked": masked,
                    "env": config.is_env_set(key)}
    return out


@api.put("/api/connections", dependencies=[Depends(require_admin)])
def put_connections(body: dict):
    unknown = [k for k in body if k not in CONNECTION_KEYS]
    if unknown:
        raise HTTPException(422, f"unknown_keys: {unknown}")
    skipped = []
    for key, value in body.items():
        if config.is_env_set(key):
            skipped.append(key)
            continue
        config.set_setting(key, str(value))
    return {"ok": True, "skipped": skipped}


TEST_PROBES = {
    "seerr": ("seerr", "/api/v1/status"),
    "radarr": ("radarr", "/api/v3/system/status"),
    "sonarr": ("sonarr", "/api/v3/system/status"),
    "tmdb": ("pools.tmdb", "/3/configuration"),
    "trakt": ("pools.trakt", "/lists/trending"),
    "jellyfin": ("media.jellyfin", "/System/Info"),
    "plex": ("media.plex", "/"),
}


@api.post("/api/connections/{service}/test",
          dependencies=[Depends(require_admin)])
async def test_connection(service: str):
    import importlib
    if service not in TEST_PROBES:
        raise HTTPException(404, "unknown_service")
    mod_name, path = TEST_PROBES[service]
    mod = importlib.import_module(mod_name)
    try:
        async with mod.make_client() as c:
            r = await c.get(path)
            r.raise_for_status()
            if service == "plex":
                machine = (r.json().get("MediaContainer") or {}) \
                    .get("machineIdentifier")
                if machine:
                    config.set_setting("plex_machine_id", machine)
    except Exception as e:
        return {"ok": False, "message": str(e)}
    return {"ok": True, "message": "Connection successful"}


app.include_router(api, prefix=URL_BASE)

static_dir = os.environ.get("STATIC_DIR", "static")
if os.path.isdir(static_dir):
    app.mount(URL_BASE or "/",
              StaticFiles(directory=static_dir, html=True), name="static")
