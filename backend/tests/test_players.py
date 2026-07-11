import config

def test_player_crud_roundtrip(client):
    r = client.post("/api/players", json={"name": "Tim", "emoji": "🐊"})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert client.post("/api/players", json={"name": "Tim"}).status_code == 409
    r = client.delete(f"/api/players/{pid}")
    assert r.status_code == 200
    players = client.get("/api/players").json()
    assert players[0]["active"] == 0  # deactivated, not deleted
    # deactivated players vanish from /api/state
    assert client.get("/api/state").json()["players"] == []

def test_admin_pin_gates_writes_not_reads(client):
    client.post("/api/players", json={"name": "Tim"})
    config.set_setting("admin_pin", "1234")
    assert client.post("/api/players", json={"name": "Sam"}).status_code == 401
    assert client.post("/api/players", json={"name": "Sam"},
                       headers={"X-Admin-Pin": "1234"}).status_code == 201
    assert client.get("/api/players").status_code == 200   # reads never gated
    assert client.get("/api/state").status_code == 200     # game never gated

def test_admin_pin_wrong_value_rejected(client):
    config.set_setting("admin_pin", "1234")
    r = client.post("/api/players", json={"name": "Sam"},
                    headers={"X-Admin-Pin": "wrong"})
    assert r.status_code == 401
    r = client.post("/api/players", json={"name": "Sam"},
                    headers={"X-Admin-Pin": "1234"})
    assert r.status_code == 201

def test_patch_player_mapping_fields(client):
    pid = client.post("/api/players", json={"name": "Tim"}).json()["id"]
    r = client.patch(f"/api/players/{pid}", json={"plex_user": "tim"})
    assert r.status_code == 200
    assert r.json()["plex_user"] == "tim"
    assert r.json()["jellyfin_user"] is None      # untouched
    # explicit null clears; omitted field stays
    r = client.patch(f"/api/players/{pid}",
                     json={"plex_user": None, "jellyfin_user": "timj"})
    body = r.json()
    assert body["plex_user"] is None and body["jellyfin_user"] == "timj"
    # listing exposes the mapping columns
    players = client.get("/api/players").json()
    assert players[0]["jellyfin_user"] == "timj"


def test_patch_player_404_and_admin_gate(client):
    import config
    assert client.patch("/api/players/999",
                        json={"plex_user": "x"}).status_code == 404
    pid = client.post("/api/players", json={"name": "Tim"}).json()["id"]
    config.set_setting("admin_pin", "1234")
    assert client.patch(f"/api/players/{pid}",
                        json={"plex_user": "x"}).status_code == 401
    assert client.patch(f"/api/players/{pid}", json={"plex_user": "x"},
                        headers={"X-Admin-Pin": "1234"}).status_code == 200
