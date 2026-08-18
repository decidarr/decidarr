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

def test_plex_search_requests_guids(db_file):
    # Real Plex omits the Guid[] external-id array from /search unless the
    # request carries includeGuids=1 — without it the exact-tmdb rung can
    # never fire and every verdict degrades to "fuzzy" (live-verified).
    seen_urls = []
    def handler(req):
        seen_urls.append(str(req.url))
        return httpx.Response(200, json={"MediaContainer": {"Metadata": [
            {"ratingKey": "42", "title": "The Matrix", "year": 1999,
             "type": "movie", "Guid": [{"id": "tmdb://603"}]}]}})
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="http://plex:32400",
                          headers={"X-Plex-Token": "tok",
                                   "Accept": "application/json"})
    v, conf, key = asyncio.run(plex.availability(c, ITEM, "movie"))
    assert (v, conf, key) == ("available", "exact", "42")
    assert "includeGuids=1" in seen_urls[0]

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

def test_jellyfin_tv_missing_recursive_item_count_is_available(db_file, monkeypatch):
    # A result missing RecursiveItemCount entirely (some Jellyfin responses
    # omit it) must be treated as available, not filtered out as absent.
    monkeypatch.setenv("JELLYFIN_URL", "http://jf:8096")
    def handler(req):
        if "AnyProviderIdEquals" in str(req.url):
            return httpx.Response(200, json={"Items": [
                {"Id": "jf9", "Name": "Breaking Bad", "ProductionYear": 2008}]})
        return httpx.Response(200, json={"Items": []})
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="http://jf:8096")
    item = {"tmdb_id": 1396, "title": "Breaking Bad", "year": 2008}
    v, conf, key = asyncio.run(jellyfin.availability(c, item, "tv"))
    assert (v, conf, key) == ("available", "exact", "jf9")

def test_jellyfin_deep_link_none_when_url_unset(db_file, monkeypatch):
    monkeypatch.delenv("JELLYFIN_URL", raising=False)
    assert jellyfin.deep_link("jf1") is None

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


# --- recent_watches (v1.2 auto-log) ---

def _plex_rw_client(history, accounts, metadata_by_key):
    def handler(req):
        p = req.url.path
        if p == "/status/sessions/history/all":
            return httpx.Response(200, json={"MediaContainer": {"Metadata": history}})
        if p == "/accounts":
            return httpx.Response(200, json={"MediaContainer": {"Account": accounts}})
        if p.startswith("/library/metadata/"):
            key = p.rsplit("/", 1)[1]
            return httpx.Response(200, json={"MediaContainer": {"Metadata": [metadata_by_key[key]]}})
        raise AssertionError(p)
    return httpx.AsyncClient(transport=httpx.MockTransport(handler),
                             base_url="http://plex:32400")


def test_plex_recent_watches_movie(db_file):
    # 2026-07-12T08:00:00Z == epoch 1783843200
    history = [{"ratingKey": "42", "type": "movie", "viewedAt": 1783843200,
                "accountID": 1}]
    accounts = [{"id": 1, "name": "tim"}]
    meta = {"42": {"title": "The Matrix", "year": 1999,
                   "Guid": [{"id": "tmdb://603"}]}}
    plays = asyncio.run(plex.recent_watches(
        _plex_rw_client(history, accounts, meta), "2026-07-12T00:00:00Z"))
    assert plays == [{"account": "tim", "media_type": "movie", "tmdb_id": 603,
                      "title": "The Matrix", "year": 1999,
                      "played_at": "2026-07-12T08:00:00Z"}]


def test_plex_recent_watches_episode_resolves_show(db_file):
    history = [{"ratingKey": "901", "type": "episode", "viewedAt": 1783843200,
                "accountID": 2, "grandparentRatingKey": "77"}]
    accounts = [{"id": 2, "name": "sam"}]
    meta = {"77": {"title": "Breaking Bad", "year": 2008,
                   "Guid": [{"id": "tmdb://1396"}]}}
    plays = asyncio.run(plex.recent_watches(
        _plex_rw_client(history, accounts, meta), "2026-07-12T00:00:00Z"))
    assert plays[0]["media_type"] == "tv"
    assert plays[0]["tmdb_id"] == 1396 and plays[0]["title"] == "Breaking Bad"


def test_plex_recent_watches_filters_by_since(db_file):
    history = [{"ratingKey": "42", "type": "movie", "viewedAt": 1783843200,
                "accountID": 1}]
    accounts = [{"id": 1, "name": "tim"}]
    meta = {"42": {"title": "The Matrix", "year": 1999, "Guid": []}}
    plays = asyncio.run(plex.recent_watches(
        _plex_rw_client(history, accounts, meta), "2026-07-12T09:00:00Z"))
    assert plays == []  # viewedAt 08:00 is before since 09:00


def test_plex_recent_watches_never_raises(db_file):
    def handler(req):
        raise httpx.ConnectError("down")
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="http://plex:32400")
    assert asyncio.run(plex.recent_watches(c, "2026-07-12T00:00:00Z")) == []

    def bad(req):
        return httpx.Response(200, content=b"<html>proxy error</html>")
    c2 = httpx.AsyncClient(transport=httpx.MockTransport(bad),
                           base_url="http://plex:32400")
    assert asyncio.run(plex.recent_watches(c2, "2026-07-12T00:00:00Z")) == []


def test_plex_recent_watches_skips_malformed_entry_keeps_batch(db_file):
    history = [
        {"ratingKey": "9", "type": "episode", "viewedAt": 1783843200,
         "accountID": 1},                      # episode with NO grandparentRatingKey
        {"ratingKey": "42", "type": "movie", "viewedAt": 1783843200,
         "accountID": 1},
    ]
    accounts = [{"id": 1, "name": "tim"}]
    meta = {"42": {"title": "The Matrix", "year": 1999,
                   "Guid": [{"id": "tmdb://603"}]}}
    plays = asyncio.run(plex.recent_watches(
        _plex_rw_client(history, accounts, meta), "2026-07-12T00:00:00Z"))
    assert [p["title"] for p in plays] == ["The Matrix"]   # movie survived; episode skipped


def test_plex_recent_watches_isolates_failing_metadata_fetch(db_file):
    history = [
        {"ratingKey": "66", "type": "movie", "viewedAt": 1783843200, "accountID": 1},  # metadata 404s
        {"ratingKey": "42", "type": "movie", "viewedAt": 1783843200, "accountID": 1},  # good
    ]

    def handler(req):
        p = req.url.path
        if p == "/status/sessions/history/all":
            return httpx.Response(200, json={"MediaContainer": {"Metadata": history}})
        if p == "/accounts":
            return httpx.Response(200, json={"MediaContainer": {"Account": [{"id": 1, "name": "tim"}]}})
        if p == "/library/metadata/66":
            return httpx.Response(404)     # deleted item → raise_for_status raises → inner except skips it
        if p == "/library/metadata/42":
            return httpx.Response(200, json={"MediaContainer": {"Metadata": [
                {"title": "The Matrix", "year": 1999, "Guid": [{"id": "tmdb://603"}]}]}})
        raise AssertionError(p)

    c = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://plex:32400")
    plays = asyncio.run(plex.recent_watches(c, "2026-07-12T00:00:00Z"))
    assert [p["title"] for p in plays] == ["The Matrix"]  # bad entry isolated; good survives


# --- jellyfin.recent_watches ---

def _jf_rw_client(users, items_by_user, series_by_id):
    def handler(req):
        p = req.url.path
        if p == "/Users":
            return httpx.Response(200, json=users)
        if p.startswith("/Users/") and p.endswith("/Items"):
            uid = p.split("/")[2]
            ids = req.url.params.get("Ids")
            if ids:
                if ids not in series_by_id:
                    return httpx.Response(404)
                return httpx.Response(200, json={"Items": [series_by_id[ids]]})
            return httpx.Response(200, json={"Items": items_by_user.get(uid, [])})
        raise AssertionError(p)
    return httpx.AsyncClient(transport=httpx.MockTransport(handler),
                             base_url="http://jf:8096")


def test_jellyfin_recent_watches_movie_and_since_filter(db_file):
    users = [{"Id": "u1", "Name": "tim"}]
    items = {"u1": [
        {"Type": "Movie", "Name": "The Matrix", "ProductionYear": 1999,
         "ProviderIds": {"Tmdb": "603"},
         "UserData": {"Played": True,
                      "LastPlayedDate": "2026-07-12T08:00:00.0000000Z"}},
        {"Type": "Movie", "Name": "Old Watch", "ProductionYear": 1990,
         "ProviderIds": {},
         "UserData": {"Played": True,
                      "LastPlayedDate": "2026-07-01T00:00:00.0000000Z"}},
    ]}
    plays = asyncio.run(jellyfin.recent_watches(
        _jf_rw_client(users, items, {}), "2026-07-12T00:00:00Z"))
    assert plays == [{"account": "tim", "media_type": "movie", "tmdb_id": 603,
                      "title": "The Matrix", "year": 1999,
                      "played_at": "2026-07-12T08:00:00Z"}]


def test_jellyfin_recent_watches_episode_resolves_series(db_file):
    users = [{"Id": "u1", "Name": "sam"}]
    items = {"u1": [
        {"Type": "Episode", "Name": "Pilot", "SeriesId": "s77",
         "UserData": {"Played": True,
                      "LastPlayedDate": "2026-07-12T08:00:00.0000000Z"}},
    ]}
    series = {"s77": {"Name": "Breaking Bad", "ProductionYear": 2008,
                      "ProviderIds": {"Tmdb": "1396"}}}
    plays = asyncio.run(jellyfin.recent_watches(
        _jf_rw_client(users, items, series), "2026-07-12T00:00:00Z"))
    assert plays[0] == {"account": "sam", "media_type": "tv", "tmdb_id": 1396,
                        "title": "Breaking Bad", "year": 2008,
                        "played_at": "2026-07-12T08:00:00Z"}


def test_jellyfin_recent_watches_never_raises(db_file):
    def handler(req):
        return httpx.Response(200, content=b"<html>err</html>")
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="http://jf:8096")
    assert asyncio.run(jellyfin.recent_watches(c, "2026-07-12T00:00:00Z")) == []


def test_jellyfin_recent_watches_isolates_failing_series_lookup(db_file):
    # One episode's series lookup 404s (validly-keyed SeriesId, but the
    # metadata endpoint fails); a good movie play in the SAME batch (even a
    # different user) must still come back. This is non-vacuous: without
    # per-entry isolation the outer except would catch the 404-triggered
    # HTTPStatusError and discard the whole batch, returning [].
    users = [{"Id": "u1", "Name": "tim"}, {"Id": "u2", "Name": "sam"}]
    items = {
        "u1": [
            {"Type": "Movie", "Name": "The Matrix", "ProductionYear": 1999,
             "ProviderIds": {"Tmdb": "603"},
             "UserData": {"Played": True,
                          "LastPlayedDate": "2026-07-12T08:00:00.0000000Z"}},
        ],
        "u2": [
            {"Type": "Episode", "Name": "Pilot", "SeriesId": "missing-series",
             "UserData": {"Played": True,
                          "LastPlayedDate": "2026-07-12T08:00:00.0000000Z"}},
        ],
    }
    plays = asyncio.run(jellyfin.recent_watches(
        _jf_rw_client(users, items, {}), "2026-07-12T00:00:00Z"))
    assert [p["title"] for p in plays] == ["The Matrix"]


# --- plex.watched_keys ---

def _watched_client(routes):
    """MockTransport routed by URL path prefix. `routes` maps path -> JSON
    payload or an Exception instance to raise."""
    def handler(req):
        for prefix, payload in routes.items():
            if req.url.path.startswith(prefix):
                if isinstance(payload, Exception):
                    raise payload
                return httpx.Response(200, json=payload)
        return httpx.Response(404, json={})
    return httpx.AsyncClient(transport=httpx.MockTransport(handler),
                             base_url="http://plex:32400",
                             headers={"X-Plex-Token": "tok",
                                      "Accept": "application/json"})


SECTIONS = {"MediaContainer": {"Directory": [
    {"key": "1", "type": "movie"},
    {"key": "2", "type": "show"},
    {"key": "3", "type": "artist"},   # music — must be ignored
]}}


def test_watched_keys_filters_by_watched_flags(db_file):
    routes = {
        "/library/sections/1/all": {"MediaContainer": {"Metadata": [
            {"title": "Lady Bird", "year": 2017, "viewCount": 2,
             "Guid": [{"id": "tmdb://391713"}]},
            {"title": "Unwatched Film", "year": 2020, "viewCount": 0},
            {"title": "Never Played", "year": 2021},
        ]}},
        "/library/sections/2/all": {"MediaContainer": {"Metadata": [
            {"title": "Breaking Bad", "year": 2008, "viewedLeafCount": 12,
             "Guid": [{"id": "tmdb://1396"}]},
            {"title": "Unstarted Show", "year": 2019, "viewedLeafCount": 0},
        ]}},
        "/library/sections": SECTIONS,
    }
    out = asyncio.run(plex.watched_keys(_watched_client(routes)))
    assert out == [
        {"media_type": "movie", "tmdb_id": 391713,
         "title": "Lady Bird", "year": 2017},
        {"media_type": "tv", "tmdb_id": 1396,
         "title": "Breaking Bad", "year": 2008},
    ]


def test_watched_keys_isolates_section_failures(db_file):
    routes = {
        "/library/sections/1/all": {"MediaContainer": {"Metadata": [
            {"title": "Lady Bird", "year": 2017, "viewCount": 1},
        ]}},
        "/library/sections/2/all": httpx.ConnectError("boom"),
        "/library/sections": SECTIONS,
    }
    out = asyncio.run(plex.watched_keys(_watched_client(routes)))
    assert [r["title"] for r in out] == ["Lady Bird"]


def test_watched_keys_unreachable_returns_none(db_file):
    routes = {"/library/sections": httpx.ConnectError("down")}
    assert asyncio.run(plex.watched_keys(_watched_client(routes))) is None


# --- v1.11.2 hygiene: malformed-but-200 bodies must degrade, not raise ----

def test_plex_availability_survives_non_object_json(db_file):
    v, conf, key = asyncio.run(
        plex.availability(_plex_client(None), ITEM, "movie"))
    assert (v, conf, key) == ("unknown", "none", None)


def test_jellyfin_recent_watches_survives_non_list_json(db_file):
    def handler(req):
        return httpx.Response(200, json=None)  # valid JSON, wrong shape
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                               base_url="http://jf:8096")
    assert asyncio.run(jellyfin.recent_watches(client, "2026-01-01")) == []


def test_jellyfin_failed_series_lookup_is_memoized(db_file):
    """Two episodes of the same broken series must cost ONE lookup, not two."""
    series_calls = []

    def handler(req):
        if req.url.path == "/Users":
            return httpx.Response(200, json=[{"Id": "u1", "Name": "Tim"}])
        if "Ids" in dict(req.url.params):
            series_calls.append(dict(req.url.params)["Ids"])
            return httpx.Response(500)
        return httpx.Response(200, json={"Items": [
            {"Type": "Episode", "SeriesId": "s1",
             "UserData": {"LastPlayedDate": "2026-08-01T00:00:00Z"}},
            {"Type": "Episode", "SeriesId": "s1",
             "UserData": {"LastPlayedDate": "2026-08-02T00:00:00Z"}},
        ]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                               base_url="http://jf:8096")
    out = asyncio.run(jellyfin.recent_watches(client, "2026-01-01"))
    assert out == []
    assert series_calls == ["s1"]
