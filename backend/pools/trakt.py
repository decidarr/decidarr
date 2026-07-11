import httpx

import config


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url="https://api.trakt.tv",
        headers={"trakt-api-version": "2",
                 "trakt-api-key": config.resolve("trakt_client_id") or "",
                 "Content-Type": "application/json"},
        timeout=15)


async def fetch(client, source_config, media_type):
    kind = "shows" if media_type == "tv" else "movies"
    r = await client.get(f"/lists/{source_config['list_id']}/items/{kind}")
    r.raise_for_status()
    out = []
    for i, x in enumerate(r.json(), 1):
        entry = x.get("show") or x.get("movie") or {}
        out.append({"tmdb_id": (entry.get("ids") or {}).get("tmdb"),
                    "title": entry.get("title"), "year": entry.get("year"),
                    "rank": x.get("rank") or i})
    return out
