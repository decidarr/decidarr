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
