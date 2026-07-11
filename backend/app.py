import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config
import db
import radarr
import seerr
import sonarr
from media import get_backend

VERSION = "1.0.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    config.seed_settings()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/api/health")
def health():
    conn = db.get_conn()
    pool_flags = {
        mt: bool(conn.execute(
            "SELECT 1 FROM pools WHERE media_type=? AND active=1",
            (mt,)).fetchone())
        for mt in ("movie", "tv")}
    conn.close()
    return {
        "ok": True,
        "version": VERSION,
        "seerr": bool(config.resolve("seerr_url") and config.resolve("seerr_api_key")),
        "radarr": bool(config.resolve("radarr_url") and config.resolve("radarr_api_key")),
        "sonarr": bool(config.resolve("sonarr_url") and config.resolve("sonarr_api_key")),
        "media_server": config.resolve("media_server"),
        "pools": pool_flags,
    }


@app.get("/api/state")
def state():
    conn = db.get_conn()
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
    conn.close()
    return out


def require_admin(x_admin_pin: str | None = Header(None)):
    pin = config.get_setting("admin_pin")
    if pin and x_admin_pin != pin:
        raise HTTPException(401, "admin_pin_required")


class PlayerIn(BaseModel):
    name: str
    emoji: str | None = None


@app.get("/api/players")
def list_players():
    conn = db.get_conn()
    rows = [dict(r) for r in conn.execute(
        "SELECT id, name, emoji, active FROM players ORDER BY id")]
    conn.close()
    return rows


@app.post("/api/players", status_code=201, dependencies=[Depends(require_admin)])
def create_player(body: PlayerIn):
    conn = db.get_conn()
    dup = conn.execute("SELECT 1 FROM players WHERE name=?", (body.name,)).fetchone()
    if dup:
        conn.close()
        raise HTTPException(409, "player_exists")
    cur = conn.execute("INSERT INTO players(name, emoji) VALUES (?,?)",
                       (body.name, body.emoji))
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return {"id": pid, "name": body.name, "emoji": body.emoji, "active": 1}


@app.delete("/api/players/{player_id}", dependencies=[Depends(require_admin)])
def deactivate_player(player_id: int):
    conn = db.get_conn()
    conn.execute("UPDATE players SET active=0 WHERE id=?", (player_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


class EventIn(BaseModel):
    player: int
    media_type: str
    item_key: str
    title: str
    year: int | None = None
    action: str


@app.post("/api/event")
def post_event(body: EventIn):
    if body.action not in ("spun", "watched", "seen"):
        raise HTTPException(422, "action_not_allowed")
    if body.media_type not in ("movie", "tv"):
        raise HTTPException(422, "bad_media_type")
    conn = db.get_conn()
    db.log_event(conn, body.player, body.media_type, body.item_key,
                 body.title, body.year, body.action)
    conn.close()
    return {"ok": True}


class VetoIn(BaseModel):
    player: int
    media_type: str
    item_key: str
    title: str
    year: int | None = None


@app.post("/api/veto")
def post_veto(body: VetoIn):
    if body.media_type not in ("movie", "tv"):
        raise HTTPException(422, "bad_media_type")
    tokens = int(config.resolve("veto_tokens") or 1)
    tz = config.resolve("tz") or "UTC"
    conn = db.get_conn()
    used = db.vetoes_used_today(conn, body.player, tz)
    if used >= tokens:
        conn.close()
        raise HTTPException(409, "no_tokens")
    db.log_event(conn, body.player, body.media_type, body.item_key,
                 body.title, body.year, "vetoed")
    conn.close()
    return {"ok": True, "remaining": tokens - used - 1}


class ResetSeenIn(BaseModel):
    stream: str | None = None


@app.post("/api/reset-seen", dependencies=[Depends(require_admin)])
def reset_seen(body: ResetSeenIn):
    conn = db.get_conn()
    if body.stream:
        cur = conn.execute(
            "DELETE FROM events WHERE action='seen' AND media_type=?",
            (body.stream,))
    else:
        cur = conn.execute("DELETE FROM events WHERE action='seen'")
    conn.commit()
    deleted = cur.rowcount
    conn.close()
    return {"ok": True, "deleted": deleted}


@app.delete("/api/pick")
def clear_pick(stream: str):
    if stream not in ("movie", "tv"):
        raise HTTPException(422, "bad_stream")
    conn = db.get_conn()
    conn.execute("DELETE FROM current_picks WHERE media_type=?", (stream,))
    conn.commit()
    conn.close()
    return {"ok": True}


class DuelWinIn(BaseModel):
    player: int
    media_type: str
    item_key: str
    title: str
    year: int | None = None
    tmdb_id: int | None = None
    replace: bool = False


@app.post("/api/duel/win")
def duel_win(body: DuelWinIn):
    if body.media_type not in ("movie", "tv"):
        raise HTTPException(422, "bad_media_type")
    conn = db.get_conn()
    try:
        db.upsert_pick(conn, body.media_type, body.item_key, body.title,
                       body.year, body.tmdb_id, None, body.player, body.replace)
    except db.PendingPickError:
        conn.close()
        raise HTTPException(409, "pending_pick")
    db.log_event(conn, body.player, body.media_type, body.item_key,
                 body.title, body.year, "duel_won")
    conn.close()
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


@app.get("/api/status")
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


@app.post("/api/watch")
async def watch(body: WatchIn):
    if body.media_type not in ("movie", "tv"):
        raise HTTPException(422, "bad_media_type")
    if not seerr.configured():
        raise HTTPException(503, "seerr_unconfigured")
    s = await _seerr_status(body.item_key, body.media_type, body.title, body.year)
    tmdb_id = body.tmdb_id or s.get("tmdb_id")
    tvdb_id = s.get("tvdb_id")
    conn = db.get_conn()
    if s["verdict"] == "available":
        try:
            db.upsert_pick(conn, body.media_type, body.item_key, body.title,
                           body.year, tmdb_id, tvdb_id, body.player, body.replace)
        except db.PendingPickError:
            conn.close()
            raise HTTPException(409, "pending_pick")
        conn.close()
        overlay = await _media_overlay(body.media_type, body.title, body.year,
                                       tmdb_id)
        return {"verdict": "available",
                "deep_link": overlay["deep_link"] if overlay else None}
    # not available -> request it (pick committed only if request succeeds,
    # but the 409 check must come FIRST so we never request then discard)
    row = conn.execute("SELECT item_key FROM current_picks WHERE media_type=?",
                       (body.media_type,)).fetchone()
    if row and row["item_key"] != body.item_key and not body.replace:
        conn.close()
        raise HTTPException(409, "pending_pick")
    seasons = config.resolve("tv_request_seasons") or "first"
    async with seerr.make_client() as c:
        result = await seerr.request(c, tmdb_id, body.media_type, seasons)
    if not result["ok"]:
        conn.close()
        raise HTTPException(502, "request_failed")
    db.upsert_pick(conn, body.media_type, body.item_key, body.title, body.year,
                   result["tmdb_id"], result["tvdb_id"], body.player, True)
    db.log_event(conn, body.player, body.media_type, body.item_key,
                 body.title, body.year, "requested")
    conn.close()
    return {"verdict": "pending", "requested": True}


@app.get("/api/progress")
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


static_dir = os.environ.get("STATIC_DIR", "static")
if os.path.isdir(static_dir):
    app.mount(os.environ.get("URL_BASE", "") or "/",
              StaticFiles(directory=static_dir, html=True), name="static")
