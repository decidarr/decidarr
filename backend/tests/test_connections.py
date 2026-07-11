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
