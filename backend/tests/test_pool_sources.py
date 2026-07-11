import asyncio
import httpx
import pytest

from pools import custom, tmdb, trakt, get_source


def test_get_source():
    assert get_source("tmdb") is tmdb
    assert get_source("custom") is custom


def test_custom_parse_csv_rfc4180():
    data = b'title,year\n"Crouching Tiger, Hidden Dragon",2000\nHeat,1995\n'
    rows = custom.parse("list.csv", data)
    assert rows[0] == {"title": "Crouching Tiger, Hidden Dragon",
                       "year": 2000, "tmdb_id": None}
    assert rows[1]["title"] == "Heat"


def test_custom_parse_json_with_optional_tmdb_id():
    data = b'[{"title":"Heat","year":1995,"tmdb_id":949},{"title":"Ronin","year":1998}]'
    rows = custom.parse("list.json", data)
    assert rows[0]["tmdb_id"] == 949 and rows[1]["tmdb_id"] is None


def test_custom_parse_garbage_raises():
    with pytest.raises(ValueError):
        custom.parse("list.json", b"not json at all {{{")


def test_custom_parse_json_missing_title_raises():
    with pytest.raises(ValueError):
        custom.parse("list.json", b'[{"name":"Heat","release_year":1995}]')


def test_custom_parse_json_non_dict_items_raises():
    with pytest.raises(ValueError):
        custom.parse("list.json", b'["foo","bar"]')


def test_tmdb_fetch_filters_media_type_and_ranks():
    def handler(req):
        assert req.url.path == "/3/list/8296268"
        return httpx.Response(200, json={"items": [
            {"media_type": "movie", "id": 603, "title": "The Matrix",
             "release_date": "1999-03-30"},
            {"media_type": "tv", "id": 1396, "name": "Breaking Bad",
             "first_air_date": "2008-01-20"},
        ]})
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="https://api.themoviedb.org")
    items = asyncio.run(tmdb.fetch(c, {"list_id": "8296268"}, "movie"))
    assert items == [{"tmdb_id": 603, "title": "The Matrix", "year": 1999,
                      "rank": 1}]


def test_tmdb_details_tv_uses_episode_runtime():
    def handler(req):
        assert req.url.path == "/3/tv/1396"
        return httpx.Response(200, json={
            "episode_run_time": [47], "number_of_seasons": 5,
            "genres": [{"name": "Drama"}], "vote_average": 8.9,
            "poster_path": "/abc.jpg"})
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="https://api.themoviedb.org")
    d = asyncio.run(tmdb.details(c, 1396, "tv"))
    assert d == {"runtime": 47, "seasons": 5, "genres": ["Drama"],
                 "rating": 8.9, "poster": "/abc.jpg"}


def test_tmdb_details_failure_returns_empty():
    def handler(req):
        return httpx.Response(500)
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="https://api.themoviedb.org")
    assert asyncio.run(tmdb.details(c, 1, "movie")) == {}


def test_tmdb_details_non_json_200_returns_empty():
    def handler(req):
        return httpx.Response(200, content=b"<html>not json</html>",
                              headers={"content-type": "text/html"})
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="https://api.themoviedb.org")
    assert asyncio.run(tmdb.details(c, 1, "movie")) == {}


def test_tmdb_search_non_json_200_returns_none():
    def handler(req):
        return httpx.Response(200, content=b"<html>err</html>",
                              headers={"content-type": "text/html"})
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="https://api.themoviedb.org")
    assert asyncio.run(tmdb.search(c, "Heat", 1995, "movie")) is None


def test_tmdb_search_failure_returns_none():
    def handler(req):
        return httpx.Response(500)
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="https://api.themoviedb.org")
    assert asyncio.run(tmdb.search(c, "Heat", 1995, "movie")) is None


def test_trakt_fetch_shapes_shows():
    def handler(req):
        assert req.url.path == "/lists/watch-night/items/shows"
        return httpx.Response(200, json=[
            {"rank": 1, "show": {"title": "Breaking Bad", "year": 2008,
                                 "ids": {"tmdb": 1396}}}])
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler),
                          base_url="https://api.trakt.tv")
    items = asyncio.run(trakt.fetch(c, {"list_id": "watch-night"}, "tv"))
    assert items == [{"tmdb_id": 1396, "title": "Breaking Bad", "year": 2008,
                      "rank": 1}]
