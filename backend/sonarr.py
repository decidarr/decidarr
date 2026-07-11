import httpx

import config
from matching import best_match


def configured() -> bool:
    return bool(config.resolve("sonarr_url") and config.resolve("sonarr_api_key"))


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=config.resolve("sonarr_url").rstrip("/"),
        headers={"X-Api-Key": config.resolve("sonarr_api_key")},
        timeout=10)


UNKNOWN = {"state": "unknown", "percent": 0, "eta": None, "title": None,
           "landed": None}


async def progress(client, tvdb_id, title, year):
    try:
        r = await client.get("/api/v3/series")
        r.raise_for_status()
        all_series = r.json()
        series = None
        if tvdb_id:
            series = next((s for s in all_series if s.get("tvdbId") == tvdb_id),
                          None)
        if series is None and title:
            match, conf = best_match(all_series, title, year)
            if conf == "exact":
                series = match
        if series is None:
            return dict(UNKNOWN)

        eps = await client.get("/api/v3/episode",
                               params={"seriesId": series["id"]})
        eps.raise_for_status()
        s1 = [e for e in eps.json() if e.get("seasonNumber") == 1]
        landed = {"ready": sum(1 for e in s1 if e.get("hasFile")),
                  "total": len(s1)}

        q = await client.get("/api/v3/queue", params={"pageSize": 1000})
        q.raise_for_status()
        records = [x for x in q.json().get("records", [])
                   if x.get("seriesId") == series["id"]]
    except (httpx.HTTPError, ValueError):
        return dict(UNKNOWN)

    label = series["title"]
    if len(records) > 1:
        label = f"{series['title']} · {len(records)} episodes"

    if landed["ready"] >= 1:
        return {"state": "done", "percent": 100, "eta": None,
                "title": label, "landed": landed}
    if not records:
        return {"state": "searching", "percent": 0, "eta": None,
                "title": label, "landed": landed}
    size = sum(x.get("size") or 0 for x in records)
    left = sum(x.get("sizeleft") or 0 for x in records)
    etas = [x["timeleft"] for x in records if x.get("timeleft")]
    if size == 0 or left >= size:
        return {"state": "queued", "percent": 0,
                "eta": min(etas) if etas else None,
                "title": label, "landed": landed}
    return {"state": "downloading",
            "percent": round(100 * (size - left) / size, 1),
            "eta": min(etas) if etas else None,
            "title": label, "landed": landed}
