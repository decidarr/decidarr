import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

import config
import db

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


static_dir = os.environ.get("STATIC_DIR", "static")
if os.path.isdir(static_dir):
    app.mount(os.environ.get("URL_BASE", "") or "/",
              StaticFiles(directory=static_dir, html=True), name="static")
