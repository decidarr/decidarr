import asyncio
import httpx
import radarr

def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler),
                             base_url="http://radarr:7878")

def _handler(movies, queue):
    def handler(req):
        if req.url.path == "/api/v3/movie":
            return httpx.Response(200, json=movies)
        if req.url.path == "/api/v3/queue":
            return httpx.Response(200, json={"records": queue})
        raise AssertionError(req.url.path)
    return handler

MOVIE = {"id": 7, "title": "The Matrix", "hasFile": False}

def test_downloading_percent_is_size_weighted():
    q = [{"movieId": 7, "size": 1000, "sizeleft": 250,
          "timeleft": "00:04:00", "trackedDownloadState": "downloading"}]
    r = asyncio.run(radarr.progress(_client(_handler([MOVIE], q)), 603))
    assert r == {"state": "downloading", "percent": 75.0,
                 "eta": "00:04:00", "title": "The Matrix"}

def test_zero_size_is_queued_not_division_error():
    q = [{"movieId": 7, "size": 0, "sizeleft": 0, "timeleft": None,
          "trackedDownloadState": "downloading"}]
    r = asyncio.run(radarr.progress(_client(_handler([MOVIE], q)), 603))
    assert r["state"] == "queued" and r["percent"] == 0

def test_import_pending_is_importing():
    q = [{"movieId": 7, "size": 1000, "sizeleft": 0, "timeleft": None,
          "trackedDownloadState": "importPending"}]
    r = asyncio.run(radarr.progress(_client(_handler([MOVIE], q)), 603))
    assert r["state"] == "importing"

def test_has_file_is_done():
    r = asyncio.run(radarr.progress(
        _client(_handler([{**MOVIE, "hasFile": True}], [])), 603))
    assert r["state"] == "done" and r["percent"] == 100

def test_in_radarr_but_idle_is_searching():
    r = asyncio.run(radarr.progress(_client(_handler([MOVIE], [])), 603))
    assert r["state"] == "searching"

def test_not_in_radarr_is_unknown():
    r = asyncio.run(radarr.progress(_client(_handler([], [])), 603))
    assert r["state"] == "unknown"

def test_connection_error_is_unknown_never_raises():
    def handler(req):
        raise httpx.ConnectError("down")
    r = asyncio.run(radarr.progress(_client(handler), 603))
    assert r["state"] == "unknown"

def test_malformed_json_body_is_unknown():
    def handler(req):
        return httpx.Response(200, content=b"<html>Bad Gateway</html>")
    r = asyncio.run(radarr.progress(_client(handler), 603))
    assert r["state"] == "unknown"
