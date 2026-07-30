import asyncio  # noqa: F401 — parity with sibling test modules

import httpx
import db
from media import plex


def _seed_pool(media_type, items, active=1):
    """items: iterable of (tmdb_id, title, year)."""
    with db.get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO pools(name, media_type, source, config, active)"
            " VALUES (?,?,?,?,?)",
            (f"Test {media_type}", media_type, "custom", "{}", active))
        pool_id = cur.lastrowid
        for tmdb_id, title, year in items:
            conn.execute(
                "INSERT INTO items(pool_id, media_type, tmdb_id, title, year)"
                " VALUES (?,?,?,?,?)",
                (pool_id, media_type, tmdb_id, title, year))
        conn.commit()
    return pool_id


def _plex_env(monkeypatch, watched_payloads):
    """Point MEDIA_SERVER at plex and mock its API. watched_payloads maps
    section path prefixes to payloads (see routes below)."""
    monkeypatch.setenv("MEDIA_SERVER", "plex")
    monkeypatch.setenv("PLEX_URL", "http://plex:32400")
    monkeypatch.setenv("PLEX_TOKEN", "tok")
    def handler(req):
        for prefix, payload in watched_payloads.items():
            if req.url.path.startswith(prefix):
                return httpx.Response(200, json=payload)
        return httpx.Response(404, json={})
    monkeypatch.setattr(plex, "make_client", lambda: httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://plex:32400"))


ROUTES = {
    "/library/sections/1/all": {"MediaContainer": {"Metadata": [
        # exact tmdb match against the pool
        {"title": "Lady Bird", "year": 2017, "viewCount": 1,
         "Guid": [{"id": "tmdb://391713"}]},
        # no tmdb guid -> matches by normalized title+year
        {"title": "The Third Man!", "year": 1949, "viewCount": 3},
        # watched but NOT in any pool -> ignored
        {"title": "Home Video", "year": 2011, "viewCount": 5},
        # near-miss year -> exact-only matching must NOT match
        {"title": "Rebecca", "year": 2020, "viewCount": 1},
    ]}},
    "/library/sections": {"MediaContainer": {"Directory": [
        {"key": "1", "type": "movie"}]}},
}


def _seed_default_pool():
    _seed_pool("movie", [
        (391713, "Lady Bird", 2017),
        (None, "The Third Man", 1949),
        (None, "Rebecca", 1940),
        (603, "The Matrix", 1999),      # unwatched — must stay unseen
    ])


def test_backfill_marks_exact_matches_seen(client, monkeypatch):
    _seed_default_pool()
    _plex_env(monkeypatch, ROUTES)
    client.post("/api/players", json={"name": "Tim"})
    r = client.post("/api/backfill-seen", json={"player": 1})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["marked_movies"] == 2          # Lady Bird + The Third Man
    assert body["marked_tv"] == 0
    assert body["skipped_seen"] == 0
    with db.get_conn() as conn:
        seen = db.seen_keys(conn, "movie")
        rows = conn.execute(
            "SELECT player, action, source FROM events").fetchall()
    assert seen == {"tmdb:391713", "t:the third man|1949"}
    assert all(r["action"] == "seen" and r["source"] == "auto"
               and r["player"] == 1 for r in rows)


def test_backfill_rerun_skips_already_seen(client, monkeypatch):
    _seed_default_pool()
    _plex_env(monkeypatch, ROUTES)
    client.post("/api/players", json={"name": "Tim"})
    client.post("/api/backfill-seen", json={"player": 1})
    r = client.post("/api/backfill-seen", json={"player": 1})
    body = r.json()
    assert body["marked_movies"] == 0
    assert body["skipped_seen"] == 2
    with db.get_conn() as conn:
        n = conn.execute("SELECT COUNT(*) AS n FROM events").fetchone()["n"]
    assert n == 2                               # no duplicates from the re-run


def test_backfill_inactive_pool_ignored(client, monkeypatch):
    _seed_pool("movie", [(391713, "Lady Bird", 2017)], active=0)
    _plex_env(monkeypatch, ROUTES)
    client.post("/api/players", json={"name": "Tim"})
    body = client.post("/api/backfill-seen", json={"player": 1}).json()
    assert body["marked_movies"] == 0


def test_backfill_unconfigured_is_ok_false_not_500(client):
    client.post("/api/players", json={"name": "Tim"})
    r = client.post("/api/backfill-seen", json={"player": 1})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False and "media server" in body["message"].lower()


def test_backfill_unknown_player_404(client, monkeypatch):
    _plex_env(monkeypatch, ROUTES)
    assert client.post("/api/backfill-seen",
                       json={"player": 99}).status_code == 404


def test_backfill_respects_admin_pin(client, monkeypatch):
    import config
    config.set_setting("admin_pin", "1234")
    r = client.post("/api/backfill-seen", json={"player": 1})
    assert r.status_code == 401


def test_backfill_unreachable_is_ok_false_not_500(client, monkeypatch):
    _seed_default_pool()
    monkeypatch.setenv("MEDIA_SERVER", "plex")
    monkeypatch.setenv("PLEX_URL", "http://plex:32400")
    monkeypatch.setenv("PLEX_TOKEN", "tok")

    def handler(req):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(plex, "make_client", lambda: httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://plex:32400"))
    client.post("/api/players", json={"name": "Tim"})
    r = client.post("/api/backfill-seen", json={"player": 1})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert "unreachable" in body["message"].lower()
    assert body["marked_movies"] == 0
    assert body["marked_tv"] == 0
    assert body["skipped_seen"] == 0


def test_backfill_never_touches_history_or_watched_stats(client, monkeypatch):
    """Backfilled seen events must never appear in History or count as
    watched on the Board — the spec's scoreboard promise as a regression
    tripwire."""
    _seed_default_pool()
    _plex_env(monkeypatch, ROUTES)
    client.post("/api/players", json={"name": "Tim"})
    r = client.post("/api/backfill-seen", json={"player": 1})
    assert r.json()["marked_movies"] == 2

    state = client.get("/api/state").json()
    assert state["history"] == []

    stats = client.get("/api/stats").json()
    assert stats["combined"].get("Tim", {}).get("watched", 0) == 0
    assert stats["seen_total"] == 2


def test_backfill_marks_tv_shows(client, monkeypatch):
    _seed_pool("tv", [(1396, "Breaking Bad", 2008)])
    tv_routes = {
        "/library/sections/2/all": {"MediaContainer": {"Metadata": [
            {"title": "Breaking Bad", "year": 2008, "viewedLeafCount": 3,
             "Guid": [{"id": "tmdb://1396"}]},
        ]}},
        "/library/sections": {"MediaContainer": {"Directory": [
            {"key": "2", "type": "show"}]}},
    }
    _plex_env(monkeypatch, tv_routes)
    client.post("/api/players", json={"name": "Tim"})
    r = client.post("/api/backfill-seen", json={"player": 1})
    body = r.json()
    assert body["marked_tv"] == 1
    assert body["marked_movies"] == 0
    with db.get_conn() as conn:
        assert db.seen_keys(conn, "tv") == {"tmdb:1396"}
