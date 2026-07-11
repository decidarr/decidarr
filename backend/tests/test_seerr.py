import asyncio
import httpx
import seerr

def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler),
                             base_url="http://seerr:5055")

def test_status_direct_movie_available():
    def handler(req):
        assert req.url.path == "/api/v1/movie/603"
        return httpx.Response(200, json={
            "id": 603, "mediaInfo": {"status": 5, "tvdbId": None}})
    r = asyncio.run(seerr.status_direct(_client(handler), 603, "movie"))
    assert r["verdict"] == "available" and r["confidence"] == "exact"

def test_partially_available_maps_available_for_tv_pending_for_movie():
    def handler(req):
        return httpx.Response(200, json={
            "id": 1, "mediaInfo": {"status": 4, "tvdbId": 81189}})
    tv = asyncio.run(seerr.status_direct(_client(handler), 1, "tv"))
    assert tv["verdict"] == "available" and tv["tvdb_id"] == 81189
    mv = asyncio.run(seerr.status_direct(_client(handler), 1, "movie"))
    assert mv["verdict"] == "pending"

def test_no_media_info_is_unrequested():
    def handler(req):
        return httpx.Response(200, json={"id": 603})
    r = asyncio.run(seerr.status_direct(_client(handler), 603, "movie"))
    assert r["verdict"] == "unrequested"

def test_status_by_title_search_and_match():
    def handler(req):
        if req.url.path == "/api/v1/search":
            return httpx.Response(200, json={"results": [
                {"mediaType": "person", "name": "The Thing Actor"},
                {"mediaType": "movie", "id": 1091, "title": "The Thing",
                 "releaseDate": "1982-06-25",
                 "mediaInfo": {"status": 5}},
            ]})
        raise AssertionError(req.url.path)
    r = asyncio.run(seerr.status_by_title(_client(handler), "The Thing", 1982, "movie"))
    assert r == {"verdict": "available", "tmdb_id": 1091, "tvdb_id": None,
                 "confidence": "exact"}

def test_status_by_title_no_match_is_notfound():
    def handler(req):
        return httpx.Response(200, json={"results": []})
    r = asyncio.run(seerr.status_by_title(_client(handler), "Nope", 1990, "movie"))
    assert r["verdict"] == "notfound"

def test_request_tv_first_season_and_id_capture():
    def handler(req):
        assert req.url.path == "/api/v1/request"
        import json
        body = json.loads(req.content)
        assert body["mediaType"] == "tv" and body["mediaId"] == 1396
        assert body["seasons"] == [1]
        return httpx.Response(201, json={
            "media": {"tmdbId": 1396, "tvdbId": 81189}})
    r = asyncio.run(seerr.request(_client(handler), 1396, "tv", "first"))
    assert r == {"ok": True, "tmdb_id": 1396, "tvdb_id": 81189}

def test_connection_error_never_raises():
    def handler(req):
        raise httpx.ConnectError("boom")
    r = asyncio.run(seerr.status_direct(_client(handler), 603, "movie"))
    assert r["verdict"] == "unknown"
    r2 = asyncio.run(seerr.request(_client(handler), 603, "movie", "first"))
    assert r2["ok"] is False
