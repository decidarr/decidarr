import config

def _player(client, name="Tim"):
    return client.post("/api/players", json={"name": name}).json()["id"]

def _evt(pid, action="spun", mt="movie", key="tmdb:603"):
    return {"player": pid, "media_type": mt, "item_key": key,
            "title": "The Matrix", "year": 1999, "action": action}

def test_event_allows_only_spun_watched_seen(client):
    pid = _player(client)
    assert client.post("/api/event", json=_evt(pid, "spun")).status_code == 200
    for bad in ("vetoed", "requested", "duel_won", "bogus"):
        r = client.post("/api/event", json=_evt(pid, bad))
        assert r.status_code == 422, bad

def test_watched_event_clears_matching_pick_only(client, db_file):
    import db
    pid = _player(client)
    conn = db.get_conn(db_file)
    conn.execute(
        "INSERT INTO current_picks(media_type,item_key,title,picked_by,ts)"
        " VALUES ('movie','tmdb:603','The Matrix',?, '2026-07-11T00:00:00Z')",
        (pid,))
    # Non-matching row: same item_key, different media_type — must survive.
    conn.execute(
        "INSERT INTO current_picks(media_type,item_key,title,picked_by,ts)"
        " VALUES ('tv','tmdb:603','The Matrix',?, '2026-07-11T00:00:00Z')",
        (pid,))
    conn.commit(); conn.close()
    client.post("/api/event", json=_evt(pid, "watched"))
    picks = client.get("/api/state").json()["current_picks"]
    assert "movie" not in picks
    assert picks["tv"]["item_key"] == "tmdb:603"

def test_veto_spends_tokens_and_409s_when_exhausted(client):
    pid = _player(client)
    body = {"player": pid, "media_type": "movie", "item_key": "tmdb:1",
            "title": "A", "year": 2020}
    r = client.post("/api/veto", json=body)
    assert r.status_code == 200 and r.json()["remaining"] == 0
    r = client.post("/api/veto", json={**body, "item_key": "tmdb:2"})
    assert r.status_code == 409 and r.json()["detail"] == "no_tokens"

def test_veto_rejects_bad_media_type(client):
    pid = _player(client)
    r = client.post("/api/veto", json={"player": pid, "media_type": "music",
                    "item_key": "tmdb:1", "title": "A"})
    assert r.status_code == 422

def test_veto_tokens_setting_raises_allowance(client):
    config.set_setting("veto_tokens", "2")
    pid = _player(client)
    body = {"player": pid, "media_type": "movie", "item_key": "tmdb:1",
            "title": "A"}
    assert client.post("/api/veto", json=body).status_code == 200
    assert client.post("/api/veto", json={**body, "item_key": "tmdb:2"}).status_code == 200
    assert client.post("/api/veto", json={**body, "item_key": "tmdb:3"}).status_code == 409

def test_reset_seen_stream_scoped(client):
    pid = _player(client)
    client.post("/api/event", json=_evt(pid, "seen", "movie", "tmdb:1"))
    client.post("/api/event", json=_evt(pid, "seen", "tv", "tmdb:2"))
    r = client.post("/api/reset-seen", json={"stream": "movie"})
    assert r.status_code == 200 and r.json()["deleted"] == 1
    seen = client.get("/api/state").json()["seen"]
    assert seen["movie"] == [] and seen["tv"] == ["tmdb:2"]
