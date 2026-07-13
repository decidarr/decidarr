import json

import httpx
import config


def test_connections_read_masks_secrets(client, monkeypatch):
    monkeypatch.setenv("SEERR_URL", "http://s:5055")
    config.set_setting("radarr_api_key", "supersecret99")
    body = client.get("/api/connections").json()
    assert body["seerr_url"]["env"] is True
    assert body["seerr_url"]["value"] == "http://s:5055"
    assert body["radarr_api_key"]["value"] == "••••99"
    assert body["radarr_api_key"]["masked"] is True


def test_connections_put_writes_and_skips_env_keys(client, monkeypatch):
    monkeypatch.setenv("SEERR_URL", "http://env:5055")
    r = client.put("/api/connections", json={
        "seerr_url": "http://nope", "sonarr_url": "http://sonarr:8989"})
    assert r.status_code == 200
    assert r.json()["skipped"] == ["seerr_url"]
    assert config.get_setting("sonarr_url") == "http://sonarr:8989"
    assert config.get_setting("seerr_url") is None


def test_connections_put_unknown_key_422(client):
    assert client.put("/api/connections", json={"hacker": "x"}).status_code == 422


def test_connections_put_sets_media_server(client, monkeypatch):
    # The Settings media-server selector writes this key; get_backend() maps
    # it and /api/health surfaces it. Guards that whole contract.
    r = client.put("/api/connections", json={"media_server": "plex"})
    assert r.status_code == 200 and r.json()["skipped"] == []
    assert config.get_setting("media_server") == "plex"
    assert client.get("/api/health").json()["media_server"] == "plex"
    # "None" clears the active backend back to null.
    client.put("/api/connections", json={"media_server": ""})
    assert client.get("/api/health").json()["media_server"] in (None, "")
    # Env-set wins and is read-only: PUT is skipped, GET reports env + value.
    monkeypatch.setenv("MEDIA_SERVER", "jellyfin")
    assert client.put("/api/connections", json={"media_server": "plex"}) \
        .json()["skipped"] == ["media_server"]
    ms = client.get("/api/connections").json()["media_server"]
    assert ms["env"] is True and ms["value"] == "jellyfin"


def test_connections_read_never_exposes_admin_pin(client):
    config.set_setting("admin_pin", "1234")
    body = client.get("/api/connections").json()
    assert "34" not in json.dumps(body["admin_pin"])
    assert body["admin_pin"]["set"] is True
    assert body["admin_pin"]["value"] is None


def test_plex_test_caches_machine_identifier(client, monkeypatch):
    from media import plex
    def handler(req):
        return httpx.Response(200, json={
            "MediaContainer": {"machineIdentifier": "abc123"}})
    monkeypatch.setenv("PLEX_URL", "http://plex:32400")
    monkeypatch.setenv("PLEX_TOKEN", "tok")
    monkeypatch.setattr(plex, "make_client", lambda: httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://plex:32400"))
    r = client.post("/api/connections/plex/test")
    assert r.json()["ok"] is True
    assert config.get_setting("plex_machine_id") == "abc123"


def test_test_unconfigured_service_returns_clean_message(client):
    # No URL configured for seerr — make_client() must not leak a raw
    # AttributeError ("'NoneType' object has no attribute 'rstrip'").
    r = client.post("/api/connections/seerr/test")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert "rstrip" not in body["message"]
    assert "NoneType" not in body["message"]
    assert "Not configured" in body["message"]


def test_failed_test_is_ok_false_not_500(client, monkeypatch):
    import seerr
    def handler(req):
        raise httpx.ConnectError("refused")
    monkeypatch.setenv("SEERR_URL", "http://s:5055")
    monkeypatch.setenv("SEERR_API_KEY", "k")
    monkeypatch.setattr(seerr, "make_client", lambda: httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://s:5055"))
    r = client.post("/api/connections/seerr/test")
    assert r.status_code == 200 and r.json()["ok"] is False
