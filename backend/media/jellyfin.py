import httpx

import config
from matching import best_match


def configured() -> bool:
    return bool(config.resolve("jellyfin_url") and config.resolve("jellyfin_api_key"))


def make_client() -> httpx.AsyncClient:
    url = config.resolve("jellyfin_url")
    if not url:
        raise RuntimeError("Not configured — set a URL first")
    return httpx.AsyncClient(
        base_url=url.rstrip("/"),
        headers={"X-Emby-Token": config.resolve("jellyfin_api_key")},
        timeout=10)


ITEM_TYPES = {"movie": "Movie", "tv": "Series"}
FIELDS = "ProviderIds,ProductionYear,RecursiveItemCount"


def _playable(it: dict, media_type: str) -> bool:
    if media_type == "tv" and "RecursiveItemCount" in it:
        return (it["RecursiveItemCount"] or 0) >= 1
    return True


def _shape(items):
    return [{"title": it.get("Name"), "year": it.get("ProductionYear"),
             "raw": it} for it in items]


async def availability(client, item, media_type):
    base = {"Recursive": "true", "IncludeItemTypes": ITEM_TYPES[media_type],
            "fields": FIELDS}
    try:
        if item.get("tmdb_id"):
            r = await client.get("/Items", params={
                **base, "AnyProviderIdEquals": f"Tmdb.{item['tmdb_id']}"})
            r.raise_for_status()
            hits = r.json().get("Items", [])
            if hits:
                hit = hits[0]
                if not _playable(hit, media_type):
                    return ("absent", "exact", None)
                return ("available", "exact", hit["Id"])
        r = await client.get("/Items", params={
            **base, "searchTerm": item["title"]})
        r.raise_for_status()
        cands = _shape(r.json().get("Items", []))
    except (httpx.HTTPError, ValueError):
        return ("unknown", "none", None)
    match, conf = best_match(cands, item["title"], item.get("year"))
    if match:
        hit = match["raw"]
        if not _playable(hit, media_type):
            return ("absent", "fuzzy", None)
        return ("available", "fuzzy", hit["Id"])
    return ("absent", "none", None)


def deep_link(native_id):
    url = config.resolve("jellyfin_url")
    if not url:
        return None
    return f"{url.rstrip('/')}/web/index.html#!/details?id={native_id}"


async def recent_watches(client, since):
    raise NotImplementedError  # reserved for v1.2 auto-log
