import asyncio
import httpx
import sonarr

SERIES = [{"id": 3, "title": "Breaking Bad", "year": 2008, "tvdbId": 81189}]

def _client(series=SERIES, episodes=(), queue=()):
    def handler(req):
        if req.url.path == "/api/v3/series":
            return httpx.Response(200, json=series)
        if req.url.path == "/api/v3/episode":
            return httpx.Response(200, json=list(episodes))
        if req.url.path == "/api/v3/queue":
            return httpx.Response(200, json={"records": list(queue)})
        raise AssertionError(req.url.path)
    return httpx.AsyncClient(transport=httpx.MockTransport(handler),
                             base_url="http://sonarr:8989")

def _ep(n, has_file):
    return {"seriesId": 3, "seasonNumber": 1, "episodeNumber": n,
            "hasFile": has_file}

def test_multi_episode_percent_is_size_weighted():
    q = [{"seriesId": 3, "size": 1000, "sizeleft": 1000, "timeleft": "01:00:00"},
         {"seriesId": 3, "size": 3000, "sizeleft": 0, "timeleft": "00:10:00"}]
    eps = [_ep(1, False), _ep(2, False)]
    r = asyncio.run(sonarr.progress(_client(episodes=eps, queue=q), 81189, None, None))
    assert r["state"] == "downloading"
    assert r["percent"] == 75.0            # (4000-1000)/4000
    assert "2 episodes" in r["title"]

def test_done_when_first_episode_imported_with_landed_counts():
    eps = [_ep(1, True), _ep(2, False), _ep(3, False)]
    q = [{"seriesId": 3, "size": 1000, "sizeleft": 500, "timeleft": "00:30:00"}]
    r = asyncio.run(sonarr.progress(_client(episodes=eps, queue=q), 81189, None, None))
    assert r["state"] == "done"            # watchable-first, queue still busy
    assert r["landed"] == {"ready": 1, "total": 3}

def test_title_year_fallback_requires_exact():
    r = asyncio.run(sonarr.progress(
        _client(episodes=[_ep(1, False)]), None, "Breaking Bad", 2008))
    assert r["state"] in ("searching", "downloading")  # resolved
    r = asyncio.run(sonarr.progress(_client(), None, "Braking Bad", 2008))
    assert r["state"] == "unknown"         # near-miss title must NOT resolve

def test_unresolvable_is_unknown():
    r = asyncio.run(sonarr.progress(_client(series=[]), 99999, None, None))
    assert r["state"] == "unknown"

def test_exact_title_wrong_year_is_unknown():
    # highest-risk match case: exact title, year off by 1, no tvdb_id.
    # best_match reports this as "fuzzy" (within the +/-1 window), but
    # sonarr only ever accepts conf == "exact" — must NOT fall back to a
    # wrong series' progress bar.
    r = asyncio.run(sonarr.progress(_client(), None, "Breaking Bad", 2009))
    assert r["state"] == "unknown"

def test_no_queue_no_files_is_searching():
    r = asyncio.run(sonarr.progress(
        _client(episodes=[_ep(1, False)]), 81189, None, None))
    assert r["state"] == "searching"

def test_connection_error_is_unknown():
    def handler(req):
        raise httpx.ConnectError("down")
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="http://sonarr:8989")
    assert asyncio.run(sonarr.progress(c, 81189, None, None))["state"] == "unknown"

def test_malformed_json_body_is_unknown():
    def handler(req):
        return httpx.Response(200, content=b"<html>Bad Gateway</html>")
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="http://sonarr:8989")
    assert asyncio.run(sonarr.progress(c, 81189, None, None))["state"] == "unknown"
