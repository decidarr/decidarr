import asyncio
import httpx
import config
from media import plex, jellyfin, get_backend

ITEM = {"tmdb_id": 603, "title": "The Matrix", "year": 1999}


def _plex_client(payload):
    def handler(req):
        assert req.headers["X-Plex-Token"] == "tok"
        return httpx.Response(200, json=payload)
    return httpx.AsyncClient(transport=httpx.MockTransport(handler),
                             base_url="http://plex:32400",
                             headers={"X-Plex-Token": "tok",
                                      "Accept": "application/json"})

def test_get_backend_respects_setting(db_file, monkeypatch):
    monkeypatch.setenv("MEDIA_SERVER", "jellyfin")
    assert get_backend() is jellyfin
    monkeypatch.delenv("MEDIA_SERVER")
    assert get_backend() is None

def test_plex_guid_match_is_exact(db_file):
    payload = {"MediaContainer": {"Metadata": [
        {"ratingKey": "42", "title": "The Matrix", "year": 1999,
         "type": "movie", "Guid": [{"id": "tmdb://603"}]}]}}
    v, conf, key = asyncio.run(plex.availability(_plex_client(payload), ITEM, "movie"))
    assert (v, conf, key) == ("available", "exact", "42")

def test_plex_title_year_match_is_fuzzy(db_file):
    payload = {"MediaContainer": {"Metadata": [
        {"ratingKey": "42", "title": "The Matrix", "year": 1999,
         "type": "movie", "Guid": [{"id": "imdb://tt0133093"}]}]}}
    v, conf, key = asyncio.run(plex.availability(_plex_client(payload), ITEM, "movie"))
    assert (v, conf) == ("available", "fuzzy")

def test_plex_show_needs_playable_episode(db_file):
    show = {"ratingKey": "9", "title": "Breaking Bad", "year": 2008,
            "type": "show", "leafCount": 0, "Guid": [{"id": "tmdb://1396"}]}
    payload = {"MediaContainer": {"Metadata": [show]}}
    item = {"tmdb_id": 1396, "title": "Breaking Bad", "year": 2008}
    v, _, _ = asyncio.run(plex.availability(_plex_client(payload), item, "tv"))
    assert v == "absent"
    payload["MediaContainer"]["Metadata"][0]["leafCount"] = 12
    v, _, _ = asyncio.run(plex.availability(_plex_client(payload), item, "tv"))
    assert v == "available"

def test_plex_deep_link_needs_machine_id(db_file):
    assert plex.deep_link("42") is None
    config.set_setting("plex_machine_id", "abc123")
    assert plex.deep_link("42") == \
        "https://app.plex.tv/desktop#!/server/abc123/details?key=/library/metadata/42"

def test_jellyfin_provider_id_exact(db_file, monkeypatch):
    monkeypatch.setenv("JELLYFIN_URL", "http://jf:8096")
    def handler(req):
        if "AnyProviderIdEquals" in str(req.url):
            return httpx.Response(200, json={"Items": [
                {"Id": "jf1", "Name": "The Matrix", "ProductionYear": 1999}]})
        return httpx.Response(200, json={"Items": []})
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="http://jf:8096")
    v, conf, key = asyncio.run(jellyfin.availability(c, ITEM, "movie"))
    assert (v, conf, key) == ("available", "exact", "jf1")
    assert jellyfin.deep_link("jf1") == \
        "http://jf:8096/web/index.html#!/details?id=jf1"

def test_media_errors_are_unknown(db_file):
    def handler(req):
        raise httpx.ConnectError("down")
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="http://plex:32400")
    assert asyncio.run(plex.availability(c, ITEM, "movie")) == \
        ("unknown", "none", None)


# --- Extra hardening tests: 200-with-non-JSON-body must degrade, never raise ---
# r.json() on a 200 response with a non-JSON body raises json.JSONDecodeError
# (a ValueError, NOT httpx.HTTPError). CLAUDE.md invariant #1 requires optional
# integrations to never raise for connectivity/parsing reasons.

def test_plex_non_json_body_is_unknown(db_file):
    def handler(req):
        return httpx.Response(200, text="not json")
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="http://plex:32400",
                          headers={"X-Plex-Token": "tok",
                                   "Accept": "application/json"})
    assert asyncio.run(plex.availability(c, ITEM, "movie")) == \
        ("unknown", "none", None)

def test_jellyfin_non_json_body_is_unknown(db_file, monkeypatch):
    monkeypatch.setenv("JELLYFIN_URL", "http://jf:8096")
    def handler(req):
        return httpx.Response(200, text="not json")
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="http://jf:8096")
    assert asyncio.run(jellyfin.availability(c, ITEM, "movie")) == \
        ("unknown", "none", None)
