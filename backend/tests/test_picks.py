# The tonight-pick contract, tested at the db seam (v1.9: the duel route
# that used to exercise it is gone; /api/watch keeps its own route-level
# 409/replace coverage in test_status_watch_progress.py).
from contextlib import closing

import pytest

import db


def _seed_player(conn, name="Tim"):
    conn.execute("INSERT INTO players(name) VALUES (?)", (name,))
    conn.commit()
    return conn.execute("SELECT id FROM players WHERE name=?",
                        (name,)).fetchone()["id"]


def test_upsert_commits_pick_with_ids(db_file):
    with closing(db.get_conn(db_file)) as conn:
        pid = _seed_player(conn)
        db.upsert_pick(conn, "movie", "tmdb:603", "The Matrix", 1999, 603,
                       None, pid, False)
        row = conn.execute("SELECT * FROM current_picks").fetchone()
        assert row["item_key"] == "tmdb:603" and row["tmdb_id"] == 603


def test_pending_pick_blocks_unless_replace(db_file):
    with closing(db.get_conn(db_file)) as conn:
        pid = _seed_player(conn)
        db.upsert_pick(conn, "movie", "tmdb:603", "The Matrix", 1999, 603,
                       None, pid, False)
        with pytest.raises(db.PendingPickError):
            db.upsert_pick(conn, "movie", "tmdb:604", "Reloaded", 2003, 604,
                           None, pid, False)
        db.upsert_pick(conn, "movie", "tmdb:604", "Reloaded", 2003, 604,
                       None, pid, True)
        row = conn.execute("SELECT item_key FROM current_picks").fetchone()
        assert row["item_key"] == "tmdb:604"


def test_recommitting_same_item_is_not_a_conflict(db_file):
    with closing(db.get_conn(db_file)) as conn:
        pid = _seed_player(conn)
        for _ in range(2):
            db.upsert_pick(conn, "movie", "tmdb:603", "The Matrix", 1999, 603,
                           None, pid, False)
        assert conn.execute(
            "SELECT COUNT(*) c FROM current_picks").fetchone()["c"] == 1


def test_streams_hold_independent_picks_even_same_key(db_file):
    # identity is (media_type, item_key) — invariant #3
    with closing(db.get_conn(db_file)) as conn:
        pid = _seed_player(conn)
        db.upsert_pick(conn, "movie", "tmdb:603", "The Matrix", 1999, 603,
                       None, pid, False)
        db.upsert_pick(conn, "tv", "tmdb:603", "Some Show", 2010, 603,
                       None, pid, False)
        rows = {r["media_type"]: r["title"] for r in
                conn.execute("SELECT media_type, title FROM current_picks")}
        assert rows == {"movie": "The Matrix", "tv": "Some Show"}


def test_delete_pick_clears_one_stream(client, db_file):
    with closing(db.get_conn(db_file)) as conn:
        pid = _seed_player(conn)
        db.upsert_pick(conn, "movie", "tmdb:603", "The Matrix", 1999, 603,
                       None, pid, False)
        db.upsert_pick(conn, "tv", "tmdb:1396", "Breaking Bad", 2008, 1396,
                       None, pid, False)
    assert client.delete("/api/pick?stream=movie").status_code == 200
    picks = client.get("/api/state").json()["current_picks"]
    assert set(picks) == {"tv"}
