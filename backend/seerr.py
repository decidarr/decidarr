import httpx

import config
from matching import best_match


def configured() -> bool:
    return bool(config.resolve("seerr_url") and config.resolve("seerr_api_key"))


def make_client() -> httpx.AsyncClient:
    url = config.resolve("seerr_url")
    if not url:
        raise RuntimeError("Not configured — set a URL first")
    return httpx.AsyncClient(
        base_url=url.rstrip("/"),
        headers={"X-Api-Key": config.resolve("seerr_api_key")},
        timeout=10)


def _verdict(status: int | None, media_type: str) -> str:
    if status == 5:
        return "available"
    if status == 4:
        return "available" if media_type == "tv" else "pending"
    if status in (2, 3):
        return "pending"
    return "unrequested"


def _year(result: dict) -> int | None:
    date = result.get("releaseDate") or result.get("firstAirDate") or ""
    return int(date[:4]) if date[:4].isdigit() else None


async def status_direct(client, tmdb_id, media_type):
    path = f"/api/v1/{'tv' if media_type == 'tv' else 'movie'}/{tmdb_id}"
    try:
        r = await client.get(path)
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError):
        return {"verdict": "unknown", "tmdb_id": tmdb_id, "tvdb_id": None,
                "confidence": "exact"}
    info = data.get("mediaInfo") or {}
    return {"verdict": _verdict(info.get("status"), media_type),
            "tmdb_id": tmdb_id, "tvdb_id": info.get("tvdbId"),
            "confidence": "exact"}


async def status_by_title(client, title, year, media_type):
    try:
        r = await client.get("/api/v1/search", params={"query": title})
        r.raise_for_status()
        results = r.json().get("results", [])
    except (httpx.HTTPError, ValueError):
        return {"verdict": "unknown", "tmdb_id": None, "tvdb_id": None,
                "confidence": "none"}
    cands = [{"title": x.get("title") or x.get("name"), "year": _year(x),
              "raw": x}
             for x in results if x.get("mediaType") == media_type]
    match, conf = best_match(cands, title, year)
    if not match:
        return {"verdict": "notfound", "tmdb_id": None, "tvdb_id": None,
                "confidence": "none"}
    raw = match["raw"]
    info = raw.get("mediaInfo") or {}
    return {"verdict": _verdict(info.get("status"), media_type),
            "tmdb_id": raw.get("id"), "tvdb_id": info.get("tvdbId"),
            "confidence": conf}


async def request(client, tmdb_id, media_type, seasons):
    body = {"mediaType": media_type, "mediaId": tmdb_id}
    if media_type == "tv" and seasons != "all":
        body["seasons"] = [1]
    try:
        r = await client.post("/api/v1/request", json=body)
        r.raise_for_status()
        media = r.json().get("media") or {}
    except (httpx.HTTPError, ValueError):
        return {"ok": False, "tmdb_id": tmdb_id, "tvdb_id": None}
    return {"ok": True, "tmdb_id": media.get("tmdbId", tmdb_id),
            "tvdb_id": media.get("tvdbId")}
