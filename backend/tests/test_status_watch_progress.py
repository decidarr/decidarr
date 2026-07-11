import pytest


def _player(client, name="Tim"):
    return client.post("/api/players", json={"name": name}).json()["id"]


class _FakeClient:
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False


@pytest.fixture
def seerr_available(monkeypatch):
    async def fake_direct(client, tmdb_id, media_type):
        return {"verdict": "available", "tmdb_id": tmdb_id,
                "tvdb_id": 81189 if media_type == "tv" else None,
                "confidence": "exact"}
    import seerr
    monkeypatch.setattr(seerr, "configured", lambda: True)
    monkeypatch.setattr(seerr, "make_client", lambda: _FakeClient())
    monkeypatch.setattr(seerr, "status_direct", fake_direct)


def test_status_tmdb_path_uses_direct_lookup(client, seerr_available):
    r = client.get("/api/status", params={
        "item_key": "tmdb:603", "type": "movie",
        "title": "The Matrix", "year": 1999})
    assert r.status_code == 200
    assert r.json()["verdict"] == "available"


def test_status_unconfigured_is_unknown_not_error(client):
    r = client.get("/api/status", params={
        "item_key": "tmdb:603", "type": "movie", "title": "X", "year": 1999})
    assert r.status_code == 200 and r.json()["verdict"] == "unknown"


def test_status_bad_media_type_is_422(client):
    r = client.get("/api/status", params={
        "item_key": "tmdb:603", "type": "podcast", "title": "X", "year": 1999})
    assert r.status_code == 422


def test_watch_unavailable_requests_and_captures_ids(client, monkeypatch):
    import seerr
    async def fake_direct(client_, tmdb_id, media_type):
        return {"verdict": "unrequested", "tmdb_id": tmdb_id,
                "tvdb_id": None, "confidence": "exact"}
    async def fake_request(client_, tmdb_id, media_type, seasons):
        assert seasons == "first"
        return {"ok": True, "tmdb_id": tmdb_id, "tvdb_id": 81189}
    monkeypatch.setattr(seerr, "configured", lambda: True)
    monkeypatch.setattr(seerr, "make_client", lambda: _FakeClient())
    monkeypatch.setattr(seerr, "status_direct", fake_direct)
    monkeypatch.setattr(seerr, "request", fake_request)
    pid = _player(client)
    r = client.post("/api/watch", json={
        "player": pid, "media_type": "tv", "item_key": "tmdb:1396",
        "title": "Breaking Bad", "year": 2008, "tmdb_id": 1396})
    assert r.status_code == 200 and r.json()["requested"] is True
    state = client.get("/api/state").json()
    assert state["current_picks"]["tv"]["tvdb_id"] == 81189   # Sonarr's key
    assert state["history"][0]["action"] == "requested"


def test_watch_409_on_pending_pick(client, seerr_available):
    pid = _player(client)
    body = {"player": pid, "media_type": "movie", "item_key": "tmdb:603",
            "title": "The Matrix", "year": 1999, "tmdb_id": 603}
    assert client.post("/api/watch", json=body).status_code == 200
    other = {**body, "item_key": "tmdb:604", "tmdb_id": 604, "title": "R"}
    assert client.post("/api/watch", json=other).status_code == 409
    assert client.post("/api/watch", json={**other, "replace": True}).status_code == 200


def test_watch_409_before_request_in_request_branch(client, monkeypatch):
    # The "not available" branch must run the pending-pick 409 check BEFORE
    # issuing seerr.request, so we never request-then-discard.
    import seerr
    calls = []

    async def fake_direct(client_, tmdb_id, media_type):
        return {"verdict": "unrequested", "tmdb_id": tmdb_id,
                "tvdb_id": None, "confidence": "exact"}

    async def fake_request(client_, tmdb_id, media_type, seasons):
        calls.append(tmdb_id)
        return {"ok": True, "tmdb_id": tmdb_id, "tvdb_id": None}

    monkeypatch.setattr(seerr, "configured", lambda: True)
    monkeypatch.setattr(seerr, "make_client", lambda: _FakeClient())
    monkeypatch.setattr(seerr, "status_direct", fake_direct)
    monkeypatch.setattr(seerr, "request", fake_request)

    pid = _player(client)
    item_a = {"player": pid, "media_type": "movie", "item_key": "tmdb:603",
              "title": "The Matrix", "year": 1999, "tmdb_id": 603}
    # First unavailable item -> requested, pick now pending.
    r = client.post("/api/watch", json=item_a)
    assert r.status_code == 200 and r.json()["requested"] is True
    assert len(calls) == 1

    # Different unavailable item, same stream, no replace -> 409 AND the
    # request must NOT have fired again (proves 409 check precedes request).
    item_b = {**item_a, "item_key": "tmdb:604", "tmdb_id": 604, "title": "R"}
    r = client.post("/api/watch", json=item_b)
    assert r.status_code == 409 and r.json()["detail"] == "pending_pick"
    assert len(calls) == 1  # never request-then-discard

    # With replace -> proceeds and requests again.
    r = client.post("/api/watch", json={**item_b, "replace": True})
    assert r.status_code == 200 and r.json()["requested"] is True
    assert len(calls) == 2


def test_watch_503_when_seerr_unconfigured(client):
    pid = _player(client)
    r = client.post("/api/watch", json={
        "player": pid, "media_type": "movie", "item_key": "tmdb:603",
        "title": "X", "tmdb_id": 603})
    assert r.status_code == 503 and r.json()["detail"] == "seerr_unconfigured"


def test_watch_bad_media_type_is_422_not_500(client):
    pid = _player(client)
    r = client.post("/api/watch", json={
        "player": pid, "media_type": "podcast", "item_key": "tmdb:603",
        "title": "X", "tmdb_id": 603})
    assert r.status_code == 422


def test_progress_routes_and_never_5xx(client, monkeypatch):
    import radarr, sonarr
    async def fake_movie(client_, tmdb):
        return {"state": "downloading", "percent": 50.0, "eta": "00:10:00",
                "title": "The Matrix"}
    async def fake_tv(client_, tvdb, title, year):
        assert tvdb == 81189
        return {"state": "done", "percent": 100, "eta": None,
                "title": "Breaking Bad", "landed": {"ready": 1, "total": 10}}
    monkeypatch.setattr(radarr, "configured", lambda: True)
    monkeypatch.setattr(radarr, "make_client", lambda: _FakeClient())
    monkeypatch.setattr(radarr, "progress", fake_movie)
    monkeypatch.setattr(sonarr, "configured", lambda: True)
    monkeypatch.setattr(sonarr, "make_client", lambda: _FakeClient())
    monkeypatch.setattr(sonarr, "progress", fake_tv)
    r = client.get("/api/progress", params={"type": "movie", "tmdb": 603})
    assert r.json()["state"] == "downloading"
    r = client.get("/api/progress", params={"type": "tv", "tvdb": 81189})
    assert r.json()["landed"] == {"ready": 1, "total": 10}


def test_progress_unconfigured_state_not_error(client):
    r = client.get("/api/progress", params={"type": "movie", "tmdb": 603})
    assert r.status_code == 200 and r.json()["state"] == "unconfigured"


def test_progress_bad_media_type_is_422(client):
    r = client.get("/api/progress", params={"type": "podcast", "tmdb": 603})
    assert r.status_code == 422
