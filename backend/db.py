import os
import re
import sqlite3
import unicodedata
from contextlib import closing

SCHEMA = """
CREATE TABLE IF NOT EXISTS players(
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE,
  emoji   TEXT,
  active  INTEGER NOT NULL DEFAULT 1,
  plex_user     TEXT,
  jellyfin_user TEXT
);
CREATE TABLE IF NOT EXISTS pools(
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
  source  TEXT NOT NULL CHECK(source IN ('custom','tmdb','trakt')),
  config  TEXT NOT NULL,
  active  INTEGER NOT NULL DEFAULT 0,
  refreshed_at TEXT
);
CREATE TABLE IF NOT EXISTS items(
  id       INTEGER PRIMARY KEY,
  pool_id  INTEGER NOT NULL REFERENCES pools(id),
  media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
  tmdb_id  INTEGER,
  title    TEXT NOT NULL,
  year     INTEGER,
  runtime  INTEGER,
  seasons  INTEGER,
  genres   TEXT,
  rating   REAL,
  rank     INTEGER,
  poster   TEXT,
  UNIQUE(pool_id, tmdb_id)
);
CREATE TABLE IF NOT EXISTS events(
  id       INTEGER PRIMARY KEY,
  ts       TEXT NOT NULL,
  player   INTEGER NOT NULL REFERENCES players(id),
  media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
  item_key TEXT NOT NULL,
  title    TEXT NOT NULL,
  year     INTEGER,
  action   TEXT NOT NULL CHECK(action IN
           ('spun','vetoed','watched','seen','requested','duel_won')),
  source   TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('user','auto'))
);
CREATE TABLE IF NOT EXISTS current_picks(
  media_type TEXT PRIMARY KEY CHECK(media_type IN ('movie','tv')),
  item_key   TEXT NOT NULL,
  title      TEXT NOT NULL,
  year       INTEGER,
  tmdb_id    INTEGER,
  tvdb_id    INTEGER,
  picked_by  INTEGER NOT NULL REFERENCES players(id),
  ts         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
"""


def db_path() -> str:
    return os.environ.get("DB_PATH", "/data/decidarr.db")


def get_conn(path: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(path: str | None = None) -> None:
    with closing(get_conn(path)) as conn:
        conn.executescript(SCHEMA)
        conn.commit()


def normalize(title: str) -> str:
    """lowercase, strip diacritics, drop punctuation, collapse whitespace.
    Leading articles are KEPT — year anchoring disambiguates."""
    s = unicodedata.normalize("NFKD", title)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^\w\s]", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def item_key(tmdb_id: int | None, title: str, year: int | None) -> str:
    if tmdb_id is not None:
        return f"tmdb:{tmdb_id}"
    return f"t:{normalize(title)}|{year if year is not None else ''}"


# --- events & derived queries -------------------------------------------
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log_event(conn, player, media_type, item_key, title, year, action):
    ts = utc_now()
    conn.execute(
        "INSERT INTO events(ts,player,media_type,item_key,title,year,action)"
        " VALUES (?,?,?,?,?,?,?)",
        (ts, player, media_type, item_key, title, year, action))
    if action == "watched":
        conn.execute(
            "INSERT INTO events(ts,player,media_type,item_key,title,year,action)"
            " VALUES (?,?,?,?,?,?,'seen')",
            (ts, player, media_type, item_key, title, year))
        conn.execute(
            "DELETE FROM current_picks WHERE media_type=? AND item_key=?",
            (media_type, item_key))
    conn.commit()


def seen_keys(conn, media_type):
    rows = conn.execute(
        "SELECT DISTINCT item_key FROM events"
        " WHERE action='seen' AND media_type=?", (media_type,))
    return {r["item_key"] for r in rows}


def history(conn, limit=50):
    rows = conn.execute(
        "SELECT e.ts, e.player, p.name AS player_name, e.media_type,"
        "       e.item_key, e.title, e.year, e.action"
        " FROM events e JOIN players p ON p.id = e.player"
        " WHERE e.action IN ('watched','requested')"
        " ORDER BY e.id DESC LIMIT ?", (limit,))
    return [dict(r) for r in rows]


def grudges(conn):
    rows = conn.execute(
        "SELECT e.media_type, e.item_key, MAX(e.title) AS title,"
        "       p.name AS player_name, COUNT(*) AS n"
        " FROM events e JOIN players p ON p.id = e.player"
        " WHERE e.action='vetoed'"
        " GROUP BY e.media_type, e.item_key, e.player")
    agg: dict[tuple, dict] = {}
    for r in rows:
        key = (r["media_type"], r["item_key"])
        g = agg.setdefault(key, {"media_type": r["media_type"],
                                 "item_key": r["item_key"],
                                 "title": r["title"], "count": 0, "by": {}})
        g["count"] += r["n"]
        g["by"][r["player_name"]] = r["n"]
    out = [g for g in agg.values() if g["count"] >= 2]
    out.sort(key=lambda g: -g["count"])
    return out


def vetoes_used_today(conn, player, tz_name):
    try:
        tz = ZoneInfo(tz_name or "UTC")
    except Exception:
        tz = ZoneInfo("UTC")
    today = datetime.now(tz).date()
    rows = conn.execute(
        "SELECT ts FROM events WHERE action='vetoed' AND player=?", (player,))
    used = 0
    for r in rows:
        ts = datetime.strptime(r["ts"], "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc)
        if ts.astimezone(tz).date() == today:
            used += 1
    return used


class PendingPickError(Exception):
    pass


def upsert_pick(conn, media_type, item_key, title, year, tmdb_id, tvdb_id,
                picked_by, replace):
    row = conn.execute("SELECT item_key FROM current_picks WHERE media_type=?",
                       (media_type,)).fetchone()
    if row and row["item_key"] != item_key and not replace:
        raise PendingPickError()
    conn.execute(
        "INSERT INTO current_picks"
        " (media_type,item_key,title,year,tmdb_id,tvdb_id,picked_by,ts)"
        " VALUES (?,?,?,?,?,?,?,?)"
        " ON CONFLICT(media_type) DO UPDATE SET"
        "  item_key=excluded.item_key, title=excluded.title,"
        "  year=excluded.year, tmdb_id=excluded.tmdb_id,"
        "  tvdb_id=excluded.tvdb_id, picked_by=excluded.picked_by,"
        "  ts=excluded.ts",
        (media_type, item_key, title, year, tmdb_id, tvdb_id, picked_by,
         utc_now()))
    conn.commit()


def stats(conn):
    out = {"movie": {}, "tv": {}, "combined": {}}
    rows = conn.execute(
        "SELECT p.name, e.media_type, e.action, COUNT(*) AS n"
        " FROM events e JOIN players p ON p.id = e.player"
        " GROUP BY p.name, e.media_type, e.action")
    for r in rows:
        for scope in (r["media_type"], "combined"):
            player = out[scope].setdefault(r["name"], {})
            player[r["action"]] = player.get(r["action"], 0) + r["n"]
    seen_total = conn.execute(
        "SELECT COUNT(DISTINCT media_type || '|' || item_key) AS n"
        " FROM events WHERE action='seen'").fetchone()["n"]
    return {**out, "seen_total": seen_total, "top_grudges": grudges(conn)[:5]}
