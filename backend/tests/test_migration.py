import sqlite3

import db

# The pools/items shape as v1.3 shipped it — narrow CHECK, no 'plex'.
OLD_SCHEMA = """
CREATE TABLE pools(
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
  source  TEXT NOT NULL CHECK(source IN ('custom','tmdb','trakt')),
  config  TEXT NOT NULL,
  active  INTEGER NOT NULL DEFAULT 0,
  refreshed_at TEXT
);
CREATE TABLE items(
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
  UNIQUE(pool_id, tmdb_id)
);
"""


def _make_v13_db(path):
    conn = sqlite3.connect(path)
    conn.executescript(OLD_SCHEMA)
    conn.execute("INSERT INTO pools(id,name,media_type,source,config,active)"
                 " VALUES (7,'RT Top 300','movie','custom','{}',1)")
    conn.execute("INSERT INTO items(pool_id,media_type,tmdb_id,title,year)"
                 " VALUES (7,'movie',603,'The Matrix',1999)")
    conn.commit()
    conn.close()


def test_migration_widens_check_and_preserves_data(tmp_path, monkeypatch):
    path = str(tmp_path / "v13.db")
    monkeypatch.setenv("DB_PATH", path)
    _make_v13_db(path)

    db.init_db(path)

    conn = db.get_conn(path)
    # pool survived with its id, and its item link is intact
    row = conn.execute("SELECT * FROM pools WHERE id=7").fetchone()
    assert row["name"] == "RT Top 300" and row["active"] == 1
    assert conn.execute("SELECT COUNT(*) AS n FROM items WHERE pool_id=7")\
        .fetchone()["n"] == 1
    # the constraint now admits plex...
    conn.execute("INSERT INTO pools(name,media_type,source,config)"
                 " VALUES ('Lib','movie','plex','{}')")
    # ...and still rejects garbage
    try:
        conn.execute("INSERT INTO pools(name,media_type,source,config)"
                     " VALUES ('Bad','movie','netflix','{}')")
        assert False, "CHECK should have rejected unknown source"
    except sqlite3.IntegrityError:
        pass
    conn.close()


def test_migration_is_idempotent(tmp_path, monkeypatch):
    path = str(tmp_path / "v13.db")
    monkeypatch.setenv("DB_PATH", path)
    _make_v13_db(path)
    db.init_db(path)
    db.init_db(path)   # second run must be a no-op, not a failure
    conn = db.get_conn(path)
    assert conn.execute("SELECT COUNT(*) AS n FROM pools").fetchone()["n"] == 1
    conn.close()


def test_fresh_install_needs_no_migration(tmp_path, monkeypatch):
    path = str(tmp_path / "fresh.db")
    monkeypatch.setenv("DB_PATH", path)
    db.init_db(path)
    conn = db.get_conn(path)
    conn.execute("INSERT INTO pools(name,media_type,source,config)"
                 " VALUES ('Lib','movie','plex','{}')")
    conn.close()


# The events shape as v1.7 shipped it — no 'unseen' in the action CHECK.
OLD_EVENTS_SCHEMA = """
CREATE TABLE players(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, emoji TEXT,
  active INTEGER NOT NULL DEFAULT 1, plex_user TEXT, jellyfin_user TEXT
);
CREATE TABLE events(
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
"""


def _make_v17_db(path):
    conn = sqlite3.connect(path)
    conn.executescript(OLD_EVENTS_SCHEMA)
    conn.execute("INSERT INTO players(id,name) VALUES (1,'Tim')")
    conn.execute("INSERT INTO events(id,ts,player,media_type,item_key,title,year,action,source)"
                 " VALUES (42,'2026-08-01T00:00:00Z',1,'movie','tmdb:603','The Matrix',1999,'seen','auto')")
    conn.commit()
    conn.close()


def test_events_migration_admits_unseen_and_preserves_rows(tmp_path, monkeypatch):
    path = str(tmp_path / "v17.db")
    _make_v17_db(path)
    monkeypatch.setenv("DB_PATH", path)
    db.init_db()
    conn = db.get_conn(path)
    # old row survives with id and source intact
    row = conn.execute("SELECT * FROM events WHERE id=42").fetchone()
    assert row["action"] == "seen" and row["source"] == "auto"
    # and 'unseen' now inserts
    db.log_event(conn, 1, "movie", "tmdb:603", "The Matrix", 1999, "unseen")
    assert db.seen_keys(conn, "movie") == set()
    conn.close()


def test_events_migration_is_idempotent(tmp_path, monkeypatch):
    path = str(tmp_path / "v17b.db")
    _make_v17_db(path)
    monkeypatch.setenv("DB_PATH", path)
    db.init_db()
    db.init_db()  # second boot must be a no-op
    conn = db.get_conn(path)
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1
    conn.close()
