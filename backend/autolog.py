"""v1.2 auto-log: one poll cycle against the configured media server.

Trusts the server's own watched determination (recent_watches), matches
plays against active-pool items + current picks, attributes to a mapped
player (else the picker for tonight's pick), dedupes via an events-existence
check, and logs watched events with source='auto' and ts=played_at. The
watermark (settings key) only ever advances to a timestamp the server itself
asserted — never our clock — so cross-clock skew can't skip a play.
"""
from contextlib import closing
from datetime import datetime, timedelta, timezone

import config
import db
from media import get_backend, plex

ISO = "%Y-%m-%dT%H:%M:%SZ"
OVERLAP_S = 60          # re-fetch window; dedupe makes the overlap harmless
DEFAULT_INTERVAL = 300  # seconds; setting autolog_interval overrides

_OFF = ("0", "false", "no", "off")


def enabled() -> bool:
    v = config.resolve("autolog_enabled")
    return v is None or v.strip().lower() not in _OFF


def _since(watermark: str) -> str:
    dt = datetime.strptime(watermark, ISO).replace(tzinfo=timezone.utc)
    return (dt - timedelta(seconds=OVERLAP_S)).strftime(ISO)


def _matchable(conn):
    """(media_type, tmdb_id) and (media_type, normalized title, year) maps
    over active-pool items + current picks -> (item_key, title, year)."""
    by_tmdb, by_title = {}, {}

    def _add(media_type, tmdb_id, title, year):
        entry = (db.item_key(tmdb_id, title, year), title, year)
        if tmdb_id is not None:
            by_tmdb[(media_type, tmdb_id)] = entry
        by_title[(media_type, db.normalize(title), year)] = entry

    for r in conn.execute(
            "SELECT i.media_type, i.tmdb_id, i.title, i.year FROM items i"
            " JOIN pools p ON p.id = i.pool_id WHERE p.active=1"):
        _add(r["media_type"], r["tmdb_id"], r["title"], r["year"])
    for r in conn.execute("SELECT * FROM current_picks"):
        entry = (r["item_key"], r["title"], r["year"])
        if r["tmdb_id"] is not None:
            by_tmdb[(r["media_type"], r["tmdb_id"])] = entry
        by_title[(r["media_type"], db.normalize(r["title"]), r["year"])] = entry
    return by_tmdb, by_title


def _attribute(conn, account, mapping_col, media_type, item_key):
    """Mapped active player first; else the picker when the played item IS
    tonight's pick for that stream; else None (skip — logged plays must
    always be explainable)."""
    if account:
        row = conn.execute(
            f"SELECT id FROM players WHERE active=1 AND {mapping_col} IS NOT NULL"
            f" AND LOWER({mapping_col}) = LOWER(?)", (account,)).fetchone()
        if row:
            return row["id"]
    pick = conn.execute(
        "SELECT item_key, picked_by FROM current_picks WHERE media_type=?",
        (media_type,)).fetchone()
    if pick and pick["item_key"] == item_key:
        return pick["picked_by"]
    return None


def _already_logged(conn, player, media_type, item_key, played_at) -> bool:
    return conn.execute(
        "SELECT 1 FROM events WHERE action='watched' AND source='auto'"
        " AND player=? AND media_type=? AND item_key=? AND ts=?",
        (player, media_type, item_key, played_at)).fetchone() is not None


async def poll_once() -> dict:
    if not enabled():
        return {"ok": True, "logged": 0, "reason": "disabled"}
    backend = get_backend()
    if backend is None or not backend.configured():
        return {"ok": True, "logged": 0, "reason": "unconfigured"}

    watermark = config.get_setting("autolog_watermark")
    if watermark is None:
        # First run: start from now. Never backfill history into the board.
        config.set_setting("autolog_watermark", db.utc_now())
        return {"ok": True, "logged": 0, "reason": "initialized"}

    async with backend.make_client() as client:
        plays = await backend.recent_watches(client, _since(watermark))
    if not plays:
        return {"ok": True, "logged": 0, "reason": None}

    mapping_col = "plex_user" if backend is plex else "jellyfin_user"
    logged = 0
    with closing(db.get_conn()) as conn:
        by_tmdb, by_title = _matchable(conn)
        for play in plays:
            mt = play["media_type"]
            entry = None
            if play.get("tmdb_id") is not None:
                entry = by_tmdb.get((mt, play["tmdb_id"]))
            if entry is None and play.get("title"):
                entry = by_title.get((mt, db.normalize(play["title"]),
                                      play.get("year")))
            if entry is None:
                continue                     # not in the wheel's world
            item_key, title, year = entry
            player = _attribute(conn, play.get("account"), mapping_col,
                                mt, item_key)
            if player is None:
                continue                     # unattributable — skip by design
            if _already_logged(conn, player, mt, item_key, play["played_at"]):
                continue
            db.log_event(conn, player, mt, item_key, title, year, "watched",
                         source="auto", ts=play["played_at"])
            logged += 1

    new_wm = max(p["played_at"] for p in plays)
    if new_wm > watermark:
        config.set_setting("autolog_watermark", new_wm)
    return {"ok": True, "logged": logged, "reason": None}
