from contextlib import closing

import config
import db


def _seed(client, db_file):
    p1 = client.post("/api/players", json={"name": "Tim", "emoji": "🐊"}).json()
    p2 = client.post("/api/players", json={"name": "Sam", "emoji": "🐍"}).json()
    # duel_won stays a valid HISTORICAL action after the duel's removal
    # (v1.9) — logged directly, since no route writes it anymore.
    with closing(db.get_conn(db_file)) as conn:
        db.log_event(conn, p1["id"], "movie", "tmdb:1", "Movie One", 2020,
                     "duel_won")
    assert client.post("/api/event", json={
        "player": p2["id"], "media_type": "tv", "item_key": "tmdb:2",
        "title": "Show Two", "year": 2021, "action": "spun",
    }).status_code == 200
    return p1, p2


def test_stats_route_shape_and_counts(client, db_file):
    p1, p2 = _seed(client, db_file)
    r = client.get("/api/stats")
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"movie", "tv", "combined", "seen_total", "top_grudges"}
    assert body["combined"]["Tim"]["duel_won"] == 1
    assert body["movie"]["Tim"]["duel_won"] == 1
    assert body["combined"]["Sam"]["spun"] == 1
    assert body["tv"]["Sam"]["spun"] == 1
    assert body["seen_total"] == 0
    assert body["top_grudges"] == []


def test_stats_route_not_admin_gated(client, db_file):
    _seed(client, db_file)
    config.set_setting("admin_pin", "1234")
    r = client.get("/api/stats")
    assert r.status_code == 200
