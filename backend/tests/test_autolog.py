import asyncio

import pytest

import autolog
import config
import db
from media import plex


def _seed(conn):
    conn.execute("INSERT INTO players(name, plex_user) VALUES ('Tim', 'tim')")
    conn.execute("INSERT INTO players(name) VALUES ('Sam')")
    conn.execute(
        "INSERT INTO pools(name, media_type, source, config, active)"
        " VALUES ('P', 'movie', 'custom', '{}', 1)")
    conn.execute(
        "INSERT INTO items(pool_id, media_type, tmdb_id, title, year)"
        " VALUES (1, 'movie', 603, 'The Matrix', 1999)")
    conn.commit()


PLAY = {"account": "TIM", "media_type": "movie", "tmdb_id": 603,
        "title": "The Matrix", "year": 1999,
        "played_at": "2026-07-12T08:00:00Z"}


def _wire(monkeypatch, plays):
    monkeypatch.setenv("MEDIA_SERVER", "plex")
    monkeypatch.setattr(plex, "configured", lambda: True)

    class _C:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
    monkeypatch.setattr(plex, "make_client", lambda: _C())
    calls = []

    async def fake_rw(client, since):
        calls.append(since)
        return list(plays)
    monkeypatch.setattr(plex, "recent_watches", fake_rw)
    return calls


def test_first_run_initializes_watermark_and_logs_nothing(db_file, monkeypatch):
    conn = db.get_conn(db_file); _seed(conn); conn.close()
    calls = _wire(monkeypatch, [PLAY])
    r = asyncio.run(autolog.poll_once())
    assert r["reason"] == "initialized" and r["logged"] == 0
    assert calls == []                      # no fetch on first run
    assert config.get_setting("autolog_watermark")  # now set


def test_mapped_attribution_logs_watched_auto(db_file, monkeypatch):
    conn = db.get_conn(db_file); _seed(conn); conn.close()
    config.set_setting("autolog_watermark", "2026-07-12T00:00:00Z")
    _wire(monkeypatch, [PLAY])              # account TIM ≈ plex_user tim
    r = asyncio.run(autolog.poll_once())
    assert r["logged"] == 1
    conn = db.get_conn(db_file)
    row = conn.execute(
        "SELECT player, action, source, ts, item_key FROM events"
        " WHERE action='watched'").fetchone()
    assert (row["player"], row["source"], row["ts"], row["item_key"]) == \
        (1, "auto", "2026-07-12T08:00:00Z", "tmdb:603")
    # watermark advanced to the play's timestamp
    assert config.get_setting("autolog_watermark") == "2026-07-12T08:00:00Z"
    conn.close()


def test_dedupe_same_play_across_two_polls(db_file, monkeypatch):
    conn = db.get_conn(db_file); _seed(conn); conn.close()
    config.set_setting("autolog_watermark", "2026-07-12T00:00:00Z")
    _wire(monkeypatch, [PLAY])
    asyncio.run(autolog.poll_once())
    asyncio.run(autolog.poll_once())        # overlap window re-serves the play
    conn = db.get_conn(db_file)
    n = conn.execute("SELECT COUNT(*) AS n FROM events"
                     " WHERE action='watched'").fetchone()["n"]
    assert n == 1
    conn.close()


def test_unmapped_account_falls_back_to_picker_for_current_pick(db_file, monkeypatch):
    conn = db.get_conn(db_file); _seed(conn)
    db.upsert_pick(conn, "movie", "tmdb:603", "The Matrix", 1999, 603, None,
                   picked_by=2, replace=False)
    conn.close()
    config.set_setting("autolog_watermark", "2026-07-12T00:00:00Z")
    _wire(monkeypatch, [{**PLAY, "account": "stranger"}])
    r = asyncio.run(autolog.poll_once())
    assert r["logged"] == 1
    conn = db.get_conn(db_file)
    row = conn.execute("SELECT player FROM events WHERE action='watched'").fetchone()
    assert row["player"] == 2               # picked_by, and the pick clears
    assert conn.execute("SELECT COUNT(*) AS n FROM current_picks").fetchone()["n"] == 0
    conn.close()


def test_unmapped_non_pick_and_non_pool_plays_skipped(db_file, monkeypatch):
    conn = db.get_conn(db_file); _seed(conn); conn.close()
    config.set_setting("autolog_watermark", "2026-07-12T00:00:00Z")
    _wire(monkeypatch, [
        {**PLAY, "account": "stranger"},                      # unmapped, not the pick
        {**PLAY, "tmdb_id": 999, "title": "Not In Pool"},     # non-pool
    ])
    r = asyncio.run(autolog.poll_once())
    assert r["logged"] == 0


def test_title_year_fallback_requires_exact_year(db_file, monkeypatch):
    conn = db.get_conn(db_file); _seed(conn); conn.close()
    config.set_setting("autolog_watermark", "2026-07-12T00:00:00Z")
    _wire(monkeypatch, [
        {**PLAY, "tmdb_id": None},                            # exact title+year -> match
        {**PLAY, "tmdb_id": None, "year": 2000,
         "played_at": "2026-07-12T09:00:00Z"},                # year off by 1 -> skip
    ])
    r = asyncio.run(autolog.poll_once())
    assert r["logged"] == 1


def test_tv_episode_play_logs_show_and_clears_tv_pick(db_file, monkeypatch):
    conn = db.get_conn(db_file); _seed(conn)
    db.upsert_pick(conn, "tv", "tmdb:1396", "Breaking Bad", 2008, 1396, 81189,
                   picked_by=1, replace=False)
    conn.close()
    config.set_setting("autolog_watermark", "2026-07-12T00:00:00Z")
    _wire(monkeypatch, [{"account": "tim", "media_type": "tv", "tmdb_id": 1396,
                         "title": "Breaking Bad", "year": 2008,
                         "played_at": "2026-07-12T08:00:00Z"}])
    r = asyncio.run(autolog.poll_once())
    assert r["logged"] == 1
    conn = db.get_conn(db_file)
    assert conn.execute("SELECT COUNT(*) AS n FROM current_picks").fetchone()["n"] == 0
    assert db.seen_keys(conn, "tv") == {"tmdb:1396"}
    conn.close()


def test_disabled_and_unconfigured_are_noops(db_file, monkeypatch):
    conn = db.get_conn(db_file); _seed(conn); conn.close()
    config.set_setting("autolog_watermark", "2026-07-12T00:00:00Z")
    calls = _wire(monkeypatch, [PLAY])
    config.set_setting("autolog_enabled", "false")
    assert asyncio.run(autolog.poll_once())["reason"] == "disabled"
    config.set_setting("autolog_enabled", "1")
    monkeypatch.delenv("MEDIA_SERVER")
    assert asyncio.run(autolog.poll_once())["reason"] == "unconfigured"
    assert calls == []


def test_zero_plays_holds_watermark(db_file, monkeypatch):
    conn = db.get_conn(db_file); _seed(conn); conn.close()
    config.set_setting("autolog_watermark", "2026-07-12T00:00:00Z")
    _wire(monkeypatch, [])
    r = asyncio.run(autolog.poll_once())
    assert r["logged"] == 0
    assert config.get_setting("autolog_watermark") == "2026-07-12T00:00:00Z"


def test_deactivated_players_mapping_ignored(db_file, monkeypatch):
    conn = db.get_conn(db_file); _seed(conn)
    conn.execute("UPDATE players SET active=0 WHERE id=1")
    conn.commit(); conn.close()
    config.set_setting("autolog_watermark", "2026-07-12T00:00:00Z")
    _wire(monkeypatch, [PLAY])
    assert asyncio.run(autolog.poll_once())["logged"] == 0


def test_two_players_same_play_are_distinct_events(db_file, monkeypatch):
    conn = db.get_conn(db_file); _seed(conn)
    conn.execute("UPDATE players SET jellyfin_user=NULL, plex_user='sam' WHERE id=2")
    conn.commit(); conn.close()
    config.set_setting("autolog_watermark", "2026-07-12T00:00:00Z")
    _wire(monkeypatch, [PLAY, {**PLAY, "account": "sam"}])   # tim + sam, same item, same ts
    r = asyncio.run(autolog.poll_once())
    assert r["logged"] == 2
    conn = db.get_conn(db_file)
    players = {row["player"] for row in conn.execute(
        "SELECT player FROM events WHERE action='watched' AND item_key='tmdb:603'")}
    assert players == {1, 2}
    conn.close()


def test_fetch_uses_60s_overlap_window(db_file, monkeypatch):
    conn = db.get_conn(db_file); _seed(conn); conn.close()
    config.set_setting("autolog_watermark", "2026-07-12T00:00:00Z")
    calls = _wire(monkeypatch, [])
    asyncio.run(autolog.poll_once())
    assert calls == ["2026-07-11T23:59:00Z"]


def test_watermark_advances_even_when_all_plays_skipped(db_file, monkeypatch):
    conn = db.get_conn(db_file); _seed(conn); conn.close()
    config.set_setting("autolog_watermark", "2026-07-12T00:00:00Z")
    _wire(monkeypatch, [{**PLAY, "account": "stranger"}])   # unmapped, not the pick -> skipped
    r = asyncio.run(autolog.poll_once())
    assert r["logged"] == 0
    assert config.get_setting("autolog_watermark") == "2026-07-12T08:00:00Z"


@pytest.mark.parametrize("val,expected", [
    (None, True), ("1", True), ("true", True), ("anything", True),
    ("0", False), ("false", False), ("no", False), ("off", False),
    ("OFF", False), ("  false  ", False),
])
def test_enabled_truthiness(db_file, monkeypatch, val, expected):
    monkeypatch.delenv("AUTOLOG_ENABLED", raising=False)
    if val is not None:
        config.set_setting("autolog_enabled", val)
    assert autolog.enabled() is expected
