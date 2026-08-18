import asyncio
import json

import httpx
import pytest

import updates


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _tags_response(names):
    return httpx.Response(200, json={
        "results": [{"name": n} for n in names]})


def test_parse_version_handles_semver_and_noise():
    assert updates.parse_version("1.9.3") == (1, 9, 3)
    assert updates.parse_version("10.0.1") == (10, 0, 1)
    assert updates.parse_version("latest") is None
    assert updates.parse_version("1.9") is None
    assert updates.parse_version("v1.9.3") is None
    assert updates.parse_version("1.9.3-beta") is None


def test_fetch_latest_picks_highest_semver():
    async def handler(request):
        return _tags_response(["latest", "1.9.3", "1.10.0", "1.2.1", "junk"])
    async def run():
        async with _client(handler) as c:
            return await updates.fetch_latest(c)
    assert asyncio.run(run()) == "1.10.0"


def test_fetch_latest_none_when_no_semver_tags():
    async def handler(request):
        return _tags_response(["latest", "edge"])
    async def run():
        async with _client(handler) as c:
            return await updates.fetch_latest(c)
    assert asyncio.run(run()) is None


def test_fetch_latest_never_raises_on_network_error():
    async def handler(request):
        raise httpx.ConnectError("down")
    async def run():
        async with _client(handler) as c:
            return await updates.fetch_latest(c)
    assert asyncio.run(run()) is None


def test_update_route_reports_newer(client, monkeypatch):
    async def fake_fetch(c):
        return "99.0.0"
    monkeypatch.setattr(updates, "fetch_latest", fake_fetch)
    updates.reset_cache()
    r = client.get("/api/update")
    assert r.status_code == 200
    body = r.json()
    assert body["latest"] == "99.0.0"
    assert body["update_available"] is True
    assert body["current"]


def test_update_route_same_version_is_no_update(client, monkeypatch):
    from app import VERSION
    async def fake_fetch(c):
        return VERSION
    monkeypatch.setattr(updates, "fetch_latest", fake_fetch)
    updates.reset_cache()
    body = client.get("/api/update").json()
    assert body["update_available"] is False


def test_update_route_unknown_on_failure(client, monkeypatch):
    async def fake_fetch(c):
        return None
    monkeypatch.setattr(updates, "fetch_latest", fake_fetch)
    updates.reset_cache()
    body = client.get("/api/update").json()
    assert body["latest"] is None and body["update_available"] is None


def test_update_route_disabled_skips_fetch(client, monkeypatch):
    calls = []
    async def fake_fetch(c):
        calls.append(1)
        return "99.0.0"
    monkeypatch.setattr(updates, "fetch_latest", fake_fetch)
    monkeypatch.setenv("UPDATE_CHECK", "off")
    updates.reset_cache()
    body = client.get("/api/update").json()
    assert body["latest"] is None and body["update_available"] is None
    assert calls == []


def test_update_route_caches_between_calls(client, monkeypatch):
    calls = []
    async def fake_fetch(c):
        calls.append(1)
        return "99.0.0"
    monkeypatch.setattr(updates, "fetch_latest", fake_fetch)
    updates.reset_cache()
    client.get("/api/update")
    client.get("/api/update")
    assert len(calls) == 1
