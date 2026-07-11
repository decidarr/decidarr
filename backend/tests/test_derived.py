from datetime import datetime, timedelta, timezone
import db

def _seed_players(conn):
    conn.execute("INSERT INTO players(name) VALUES ('Tim'),('Sam')")

def test_watched_auto_inserts_seen_and_clears_matching_pick(db_file):
    conn = db.get_conn(db_file)
    _seed_players(conn)
    conn.execute(
        "INSERT INTO current_picks(media_type,item_key,title,picked_by,ts)"
        " VALUES ('movie','tmdb:603','The Matrix',1,'2026-07-11T00:00:00Z'),"
        "        ('tv','tmdb:603','Odd Show',1,'2026-07-11T00:00:00Z')")
    db.log_event(conn, 1, "movie", "tmdb:603", "The Matrix", 1999, "watched")
    actions = [r["action"] for r in conn.execute("SELECT action FROM events")]
    assert sorted(actions) == ["seen", "watched"]
    picks = conn.execute("SELECT media_type FROM current_picks").fetchall()
    # tv pick with same item_key SURVIVES — media_type is part of identity
    assert [p["media_type"] for p in picks] == ["tv"]
    conn.close()

def test_seen_keys_is_stream_scoped(db_file):
    conn = db.get_conn(db_file)
    _seed_players(conn)
    db.log_event(conn, 1, "movie", "tmdb:603", "The Matrix", 1999, "seen")
    db.log_event(conn, 1, "tv", "tmdb:1396", "Breaking Bad", 2008, "seen")
    assert db.seen_keys(conn, "movie") == {"tmdb:603"}
    assert db.seen_keys(conn, "tv") == {"tmdb:1396"}
    conn.close()

def test_grudges_need_two_vetoes(db_file):
    conn = db.get_conn(db_file)
    _seed_players(conn)
    db.log_event(conn, 1, "movie", "tmdb:79357", "Legend", 1985, "vetoed")
    assert db.grudges(conn) == []
    db.log_event(conn, 2, "movie", "tmdb:79357", "Legend", 1985, "vetoed")
    g = db.grudges(conn)
    assert g[0]["item_key"] == "tmdb:79357" and g[0]["count"] == 2
    assert g[0]["by"] == {"Tim": 1, "Sam": 1}
    conn.close()

def test_vetoes_used_today_is_tz_aware_and_cross_stream(db_file):
    conn = db.get_conn(db_file)
    _seed_players(conn)
    now = datetime.now(timezone.utc)
    yesterday = (now - timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute(
        "INSERT INTO events(ts,player,media_type,item_key,title,action)"
        " VALUES (?,1,'movie','tmdb:1','Old','vetoed')", (yesterday,))
    db.log_event(conn, 1, "movie", "tmdb:2", "A", None, "vetoed")
    db.log_event(conn, 1, "tv", "tmdb:3", "B", None, "vetoed")
    # both streams count against the same nightly pool
    assert db.vetoes_used_today(conn, 1, "Pacific/Auckland") == 2
    assert db.vetoes_used_today(conn, 2, "Pacific/Auckland") == 0
    conn.close()

def test_history_newest_first_watched_and_requested_only(db_file):
    conn = db.get_conn(db_file)
    _seed_players(conn)
    db.log_event(conn, 1, "movie", "tmdb:1", "First", None, "requested")
    db.log_event(conn, 1, "movie", "tmdb:2", "Second", None, "spun")
    db.log_event(conn, 2, "tv", "tmdb:3", "Third", None, "watched")
    h = db.history(conn)
    assert [e["title"] for e in h] == ["Third", "First"]
    assert h[0]["player_name"] == "Sam"
    conn.close()

def test_stats_counts_duel_won_per_stream_and_combined(db_file):
    conn = db.get_conn(db_file)
    _seed_players(conn)
    db.log_event(conn, 1, "movie", "tmdb:1", "A", None, "duel_won")
    db.log_event(conn, 1, "tv", "tmdb:2", "B", None, "duel_won")
    s = db.stats(conn)
    assert s["combined"]["Tim"]["duel_won"] == 2
    assert s["movie"]["Tim"]["duel_won"] == 1
    conn.close()
