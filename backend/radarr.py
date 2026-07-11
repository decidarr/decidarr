import httpx

import config


def configured() -> bool:
    return bool(config.resolve("radarr_url") and config.resolve("radarr_api_key"))


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=config.resolve("radarr_url").rstrip("/"),
        headers={"X-Api-Key": config.resolve("radarr_api_key")},
        timeout=10)


UNKNOWN = {"state": "unknown", "percent": 0, "eta": None, "title": None}


async def progress(client, tmdb_id):
    try:
        r = await client.get("/api/v3/movie", params={"tmdbId": tmdb_id})
        r.raise_for_status()
        movies = r.json()
        if not movies:
            return dict(UNKNOWN)
        movie = movies[0]
        if movie.get("hasFile"):
            return {"state": "done", "percent": 100, "eta": None,
                    "title": movie["title"]}
        q = await client.get("/api/v3/queue", params={"pageSize": 1000})
        q.raise_for_status()
        records = [x for x in q.json().get("records", [])
                   if x.get("movieId") == movie["id"]]
    except (httpx.HTTPError, ValueError):
        return dict(UNKNOWN)
    if not records:
        return {"state": "searching", "percent": 0, "eta": None,
                "title": movie["title"]}
    rec = records[0]
    if rec.get("trackedDownloadState") in ("importPending", "importing"):
        return {"state": "importing", "percent": 100, "eta": None,
                "title": movie["title"]}
    size, left = rec.get("size") or 0, rec.get("sizeleft") or 0
    if size == 0 or left >= size:
        return {"state": "queued", "percent": 0, "eta": rec.get("timeleft"),
                "title": movie["title"]}
    return {"state": "downloading",
            "percent": round(100 * (size - left) / size, 1),
            "eta": rec.get("timeleft"), "title": movie["title"]}
