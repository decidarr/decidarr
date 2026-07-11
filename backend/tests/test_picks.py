def _player(client, name="Tim"):
    return client.post("/api/players", json={"name": name}).json()["id"]

def _win(pid, key="tmdb:603", title="The Matrix", **kw):
    return {"player": pid, "media_type": "movie", "item_key": key,
            "title": title, "year": 1999, **kw}

def test_duel_win_upserts_pick_and_logs_event(client):
    pid = _player(client)
    r = client.post("/api/duel/win", json=_win(pid, tmdb_id=603))
    assert r.status_code == 200
    state = client.get("/api/state").json()
    assert state["current_picks"]["movie"]["item_key"] == "tmdb:603"
    assert state["current_picks"]["movie"]["tmdb_id"] == 603

def test_duel_win_409_on_pending_pick_unless_replace(client):
    pid = _player(client)
    client.post("/api/duel/win", json=_win(pid))
    r = client.post("/api/duel/win", json=_win(pid, key="tmdb:604", title="Reloaded"))
    assert r.status_code == 409 and r.json()["detail"] == "pending_pick"
    r = client.post("/api/duel/win",
                    json=_win(pid, key="tmdb:604", title="Reloaded", replace=True))
    assert r.status_code == 200
    pick = client.get("/api/state").json()["current_picks"]["movie"]
    assert pick["item_key"] == "tmdb:604"

def test_recommitting_same_item_is_not_a_conflict(client):
    pid = _player(client)
    client.post("/api/duel/win", json=_win(pid))
    assert client.post("/api/duel/win", json=_win(pid)).status_code == 200

def test_streams_are_independent(client):
    pid = _player(client)
    client.post("/api/duel/win", json=_win(pid))
    tv = {"player": pid, "media_type": "tv", "item_key": "tmdb:1396",
          "title": "Breaking Bad", "year": 2008}
    assert client.post("/api/duel/win", json=tv).status_code == 200
    picks = client.get("/api/state").json()["current_picks"]
    assert set(picks) == {"movie", "tv"}

def test_same_item_key_coexists_across_streams(client):
    pid = _player(client)
    client.post("/api/duel/win", json=_win(pid, key="tmdb:603", title="The Matrix"))
    client.post("/api/duel/win", json={"player": pid, "media_type": "tv",
                "item_key": "tmdb:603", "title": "Some Show", "year": 2010})
    picks = client.get("/api/state").json()["current_picks"]
    assert set(picks) == {"movie", "tv"}
    assert picks["movie"]["title"] == "The Matrix"
    assert picks["tv"]["title"] == "Some Show"

def test_delete_pick_clears_one_stream(client):
    pid = _player(client)
    client.post("/api/duel/win", json=_win(pid))
    r = client.delete("/api/pick?stream=movie")
    assert r.status_code == 200
    assert client.get("/api/state").json()["current_picks"] == {}
