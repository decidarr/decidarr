import asyncio

import httpx

from pools import get_source, plex as plex_pool


def _client(routes):
    def handler(req):
        for prefix, payload in routes.items():
            if req.url.path.startswith(prefix):
                if isinstance(payload, Exception):
                    raise payload
                return httpx.Response(200, json=payload)
        return httpx.Response(404, json={})
    return httpx.AsyncClient(transport=httpx.MockTransport(handler),
                             base_url="http://plex:32400")


SECTIONS = {"MediaContainer": {"Directory": [
    {"key": "1", "type": "movie", "title": "Films"},
    {"key": "2", "type": "show", "title": "TV"},
    {"key": "3", "type": "movie", "title": "Christmas"},
]}}


def test_registered_and_fetches_configured_movie_sections():
    assert get_source("plex") is plex_pool
    routes = {
        "/library/sections/1/all": {"MediaContainer": {"Metadata": [
            {"title": "Lady Bird", "year": 2017,
             "Guid": [{"id": "tmdb://391713"}]},
            {"title": "Home Video", "year": 2011},
        ]}},
        "/library/sections/3/all": {"MediaContainer": {"Metadata": [
            {"title": "Lady Bird", "year": 2017,          # dupe across sections
             "Guid": [{"id": "tmdb://391713"}]},
            {"title": "Die Hard", "year": 1988,
             "Guid": [{"id": "tmdb://562"}]},
        ]}},
        "/library/sections": SECTIONS,
    }
    out = asyncio.run(plex_pool.fetch(
        _client(routes), {"sections": ["1", "3"]}, "movie"))
    titles = [r["title"] for r in out]
    assert titles == ["Lady Bird", "Home Video", "Die Hard"]  # deduped
    assert out[0]["tmdb_id"] == 391713 and out[0]["rank"] == 1
    assert out[1]["tmdb_id"] is None                          # title+year row
    assert [r["rank"] for r in out] == [1, 2, 3]


def test_type_mismatch_and_unconfigured_sections_ignored():
    routes = {
        "/library/sections/2/all": {"MediaContainer": {"Metadata": [
            {"title": "Breaking Bad", "year": 2008,
             "Guid": [{"id": "tmdb://1396"}]},
        ]}},
        "/library/sections": SECTIONS,
    }
    # movie pool configured with a SHOW section -> nothing matches
    assert asyncio.run(plex_pool.fetch(
        _client(routes), {"sections": ["2"]}, "movie")) == []
    # tv pool with the same config -> the show flows through
    out = asyncio.run(plex_pool.fetch(
        _client(routes), {"sections": ["2"]}, "tv"))
    assert [r["title"] for r in out] == ["Breaking Bad"]


def test_failing_section_is_skipped_not_fatal():
    routes = {
        "/library/sections/1/all": {"MediaContainer": {"Metadata": [
            {"title": "Lady Bird", "year": 2017,
             "Guid": [{"id": "tmdb://391713"}]},
        ]}},
        "/library/sections/3/all": httpx.ConnectError("boom"),
        "/library/sections": SECTIONS,
    }
    out = asyncio.run(plex_pool.fetch(
        _client(routes), {"sections": ["1", "3"]}, "movie"))
    assert [r["title"] for r in out] == ["Lady Bird"]


def _plex_env(monkeypatch, routes):
    from media import plex as media_plex
    monkeypatch.setenv("PLEX_URL", "http://plex:32400")
    monkeypatch.setenv("PLEX_TOKEN", "tok")
    monkeypatch.setattr(media_plex, "make_client", lambda: _client(routes))


def test_sections_route_lists_movie_and_show_sections(client, monkeypatch):
    _plex_env(monkeypatch, {"/library/sections": {"MediaContainer": {"Directory": [
        {"key": "1", "type": "movie", "title": "Films"},
        {"key": "2", "type": "show", "title": "TV"},
        {"key": "9", "type": "artist", "title": "Music"},
    ]}}})
    body = client.get("/api/plex/sections").json()
    assert body["ok"] is True
    assert body["sections"] == [
        {"key": "1", "title": "Films", "type": "movie"},
        {"key": "2", "title": "TV", "type": "show"},
    ]


def test_sections_route_degrades_when_unconfigured(client):
    r = client.get("/api/plex/sections")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False and body["sections"] == []


def test_sections_route_degrades_when_unreachable(client, monkeypatch):
    _plex_env(monkeypatch,
              {"/library/sections": httpx.ConnectError("down")})
    body = client.get("/api/plex/sections").json()
    assert body["ok"] is False and body["sections"] == []


def test_create_plex_pool_validated(client, monkeypatch):
    # unconfigured -> 422
    r = client.post("/api/pools", json={
        "name": "Lib", "media_type": "movie", "source": "plex",
        "config": {"sections": ["1"]}})
    assert r.status_code == 422
    # configured but no sections chosen -> 422
    _plex_env(monkeypatch, {})
    r = client.post("/api/pools", json={
        "name": "Lib", "media_type": "movie", "source": "plex",
        "config": {"sections": []}})
    assert r.status_code == 422
    # configured with sections -> created
    r = client.post("/api/pools", json={
        "name": "Lib", "media_type": "movie", "source": "plex",
        "config": {"sections": ["1"]}})
    assert r.status_code == 201 and "id" in r.json()
