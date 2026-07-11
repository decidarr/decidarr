import sqlite3
import pytest
import db

def test_schema_creates_all_tables(db_file):
    conn = db.get_conn(db_file)
    names = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"players", "pools", "items", "events", "current_picks",
            "settings"} <= names
    conn.close()

def test_events_action_check_constraint(db_file):
    conn = db.get_conn(db_file)
    conn.execute("INSERT INTO players(name) VALUES ('Tim')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO events(ts,player,media_type,item_key,title,action)"
            " VALUES ('2026-07-11T00:00:00Z',1,'movie','tmdb:1','X','bogus')")
    # duel_won is valid from day one
    conn.execute(
        "INSERT INTO events(ts,player,media_type,item_key,title,action)"
        " VALUES ('2026-07-11T00:00:00Z',1,'movie','tmdb:1','X','duel_won')")
    conn.close()

def test_wal_mode(db_file):
    conn = db.get_conn(db_file)
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    conn.close()

def test_item_key():
    assert db.item_key(603, "The Matrix", 1999) == "tmdb:603"
    assert db.item_key(None, "Léon: The Professional!", 1994) == \
        "t:leon the professional|1994"

def test_normalize_keeps_leading_articles():
    assert db.normalize("The Thing") == "the thing"  # articles NOT dropped
    assert db.normalize("  Amélie — spéciale  ") == "amelie speciale"
