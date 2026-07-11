import os
import re
import sqlite3
import unicodedata

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
    conn = get_conn(path)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def normalize(title: str) -> str:
    """lowercase, strip diacritics, drop punctuation, collapse whitespace.
    Leading articles are KEPT — year anchoring disambiguates."""
    s = unicodedata.normalize("NFKD", title)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^\w\s]", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def item_key(tmdb_id: int | None, title: str, year: int | None) -> str:
    if tmdb_id:
        return f"tmdb:{tmdb_id}"
    return f"t:{normalize(title)}|{year if year is not None else ''}"
