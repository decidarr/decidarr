def test_health_unconfigured(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["seerr"] is False and body["radarr"] is False
    assert body["sonarr"] is False and body["media_server"] is None
    assert body["pools"] == {"movie": False, "tv": False}

def test_health_flags_configured_services(client, monkeypatch):
    monkeypatch.setenv("SEERR_URL", "http://s:5055")
    monkeypatch.setenv("SEERR_API_KEY", "k")
    monkeypatch.setenv("MEDIA_SERVER", "plex")
    body = client.get("/api/health").json()
    assert body["seerr"] is True
    assert body["media_server"] == "plex"

def test_health_autolog_flag(client, monkeypatch):
    assert client.get("/api/health").json()["autolog"] is False  # no server
    monkeypatch.setenv("MEDIA_SERVER", "plex")
    monkeypatch.setenv("PLEX_URL", "http://plex:32400")
    monkeypatch.setenv("PLEX_TOKEN", "tok")
    assert client.get("/api/health").json()["autolog"] is True
    import config
    config.set_setting("autolog_enabled", "false")
    assert client.get("/api/health").json()["autolog"] is False

def test_state_shape_empty_db(client):
    body = client.get("/api/state").json()
    assert body["players"] == []
    assert body["current_picks"] == {}
    assert body["seen"] == {"movie": [], "tv": []}
    assert body["history"] == [] and body["grudges"] == []
    assert body["veto_tokens"] == 1
    assert body["pools"] == {"movie": None, "tv": None}
