import httpx

import config
from matching import best_match


def configured() -> bool:
    return bool(config.resolve("plex_url") and config.resolve("plex_token"))


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=config.resolve("plex_url").rstrip("/"),
        headers={"X-Plex-Token": config.resolve("plex_token"),
                 "Accept": "application/json"},
        timeout=10)


def _playable(meta: dict, media_type: str) -> bool:
    if media_type == "tv":
        return (meta.get("leafCount") or 0) >= 1
    return True


async def availability(client, item, media_type):
    want_type = "show" if media_type == "tv" else "movie"
    try:
        r = await client.get("/search", params={"query": item["title"]})
        r.raise_for_status()
        metas = [m for m in (r.json().get("MediaContainer", {})
                             .get("Metadata") or [])
                 if m.get("type") == want_type]
    except (httpx.HTTPError, ValueError):
        return ("unknown", "none", None)
    # rung 1: provider-id exact
    if item.get("tmdb_id"):
        guid = f"tmdb://{item['tmdb_id']}"
        for m in metas:
            if any(g.get("id") == guid for g in m.get("Guid") or []):
                if not _playable(m, media_type):
                    return ("absent", "exact", None)
                return ("available", "exact", str(m["ratingKey"]))
    # rungs 2-3: title+year (reported as fuzzy)
    match, conf = best_match(metas, item["title"], item.get("year"))
    if match:
        if not _playable(match, media_type):
            return ("absent", "fuzzy", None)
        return ("available", "fuzzy", str(match["ratingKey"]))
    return ("absent", "none", None)


def deep_link(native_id):
    machine_id = config.get_setting("plex_machine_id")
    if not machine_id:
        return None
    return (f"https://app.plex.tv/desktop#!/server/{machine_id}"
            f"/details?key=/library/metadata/{native_id}")


async def recent_watches(client, since):
    raise NotImplementedError  # reserved for v1.2 auto-log
