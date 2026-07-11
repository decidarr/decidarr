import json
import pytest

def _make_pool(client, media_type="movie", source="custom", cfg=None):
    r = client.post("/api/pools", json={
        "name": "Test Pool", "media_type": media_type, "source": source,
        "config": cfg or {"items": []}})
    assert r.status_code == 201
    return r.json()["id"]

def test_one_active_pool_per_stream(client):
    a = _make_pool(client)
    b = _make_pool(client)
    tv = _make_pool(client, media_type="tv")
    client.post(f"/api/pools/{a}/activate")
    client.post(f"/api/pools/{tv}/activate")
    client.post(f"/api/pools/{b}/activate")   # displaces a, not tv
    pools = {p["id"]: p for p in client.get("/api/pools").json()}
    assert pools[a]["active"] == 0
    assert pools[b]["active"] == 1
    assert pools[tv]["active"] == 1

def test_trakt_pool_rejected_without_client_id(client):
    r = client.post("/api/pools", json={
        "name": "T", "media_type": "movie", "source": "trakt",
        "config": {"list_id": "x"}})
    assert r.status_code == 422

def test_refresh_diffs_and_enriches_incrementally(client, monkeypatch):
    import pools.refresh as refresh_mod
    from pools import tmdb as tmdb_mod
    fetched = [{"tmdb_id": 603, "title": "The Matrix", "year": 1999, "rank": 1},
               {"tmdb_id": 604, "title": "Reloaded", "year": 2003, "rank": 2}]
    calls = []
    async def fake_fetch(c, cfg, mt):
        return list(fetched)
    async def fake_details(c, tmdb_id, mt):
        calls.append(tmdb_id)
        return {"runtime": 136, "seasons": None, "genres": ["Action"],
                "rating": 8.2, "poster": "/m.jpg"}
    monkeypatch.setattr(refresh_mod, "_fetch_via_source", fake_fetch)
    monkeypatch.setattr(tmdb_mod, "details", fake_details)
    monkeypatch.setattr(tmdb_mod, "make_client",
                        lambda: __import__("httpx").AsyncClient())
    pid = _make_pool(client)
    r = client.post(f"/api/pools/{pid}/refresh")
    assert r.json()["added"] == 2 and sorted(calls) == [603, 604]
    # second refresh: 604 dropped from source, no re-enrichment of 603
    calls.clear()
    fetched.pop()
    r = client.post(f"/api/pools/{pid}/refresh")
    assert r.json()["removed"] == 1 and calls == []
    items = client.get("/api/pool?stream=movie").json()
    # pool not active yet -> empty; activate and re-read
    client.post(f"/api/pools/{pid}/activate")
    items = client.get("/api/pool?stream=movie").json()
    assert len(items) == 1 and items[0]["tmdb_id"] == 603
    assert items[0]["genres"] == ["Action"]
    assert items[0]["item_key"] == "tmdb:603"

def test_refresh_failure_keeps_previous_cache(client, monkeypatch):
    import pools.refresh as refresh_mod
    ok = [{"tmdb_id": 603, "title": "The Matrix", "year": 1999, "rank": 1}]
    state = {"fail": False}
    async def flaky_fetch(c, cfg, mt):
        if state["fail"]:
            raise RuntimeError("upstream 500")
        return ok
    async def fake_details(c, t, m):
        return {}
    from pools import tmdb as tmdb_mod
    monkeypatch.setattr(refresh_mod, "_fetch_via_source", flaky_fetch)
    monkeypatch.setattr(tmdb_mod, "details", fake_details)
    monkeypatch.setattr(tmdb_mod, "make_client",
                        lambda: __import__("httpx").AsyncClient())
    pid = _make_pool(client)
    client.post(f"/api/pools/{pid}/refresh")
    client.post(f"/api/pools/{pid}/activate")
    state["fail"] = True
    r = client.post(f"/api/pools/{pid}/refresh")
    assert r.json()["ok"] is False
    assert len(client.get("/api/pool?stream=movie").json()) == 1  # cache kept

def test_import_resolves_and_reports_unresolved(client, monkeypatch):
    from pools import tmdb as tmdb_mod
    async def fake_search(c, title, year, mt):
        return 949 if title == "Heat" else None
    async def fake_details(c, t, m):
        return {}
    monkeypatch.setattr(tmdb_mod, "search", fake_search)
    monkeypatch.setattr(tmdb_mod, "details", fake_details)
    monkeypatch.setattr(tmdb_mod, "make_client",
                        lambda: __import__("httpx").AsyncClient())
    pid = _make_pool(client)
    csv = b'title,year\nHeat,1995\n"Totally Made Up, The",2001\n'
    r = client.post("/api/pools/import",
                    data={"pool_id": str(pid)},
                    files={"file": ("list.csv", csv, "text/csv")})
    assert r.status_code == 200
    body = r.json()
    assert body["imported"] == 2
    assert body["unresolved"] == ["Totally Made Up, The"]
