from datetime import datetime

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
    # conf is deliberately discarded here — rungs 2-3 always report
    # "fuzzy" per spec, so we don't branch on best_match's own
    # exact/fuzzy/none distinction.
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


def _normalize_played_at(jf_date: str) -> str | None:
    """Jellyfin dates look like 2026-07-12T08:00:00.0000000Z — trim the
    fractional part down to our canonical %Y-%m-%dT%H:%M:%SZ."""
    try:
        base = jf_date.split(".")[0].rstrip("Z")
        return datetime.strptime(base, "%Y-%m-%dT%H:%M:%S").strftime(
            "%Y-%m-%dT%H:%M:%SZ")
    except (ValueError, AttributeError):
        return None


def _tmdb_from_provider_ids(item: dict) -> int | None:
    raw = (item.get("ProviderIds") or {}).get("Tmdb")
    try:
        return int(raw) if raw else None
    except ValueError:
        return None


RECENT_PARAMS = {"Recursive": "true", "IncludeItemTypes": "Movie,Episode",
                 "Filters": "IsPlayed", "SortBy": "DatePlayed",
                 "SortOrder": "Descending", "Limit": "50",
                 "fields": "ProviderIds,ProductionYear"}


async def recent_watches(client, since):
    """Completed plays since `since` (ISO UTC) across all users, normalized
    to {account, media_type, tmdb_id, title, year, played_at}. Episode plays
    carry the SERIES' identity. Jellyfin has no history endpoint; recently-
    played per user (IsPlayed + LastPlayedDate) is the equivalent.

    Per-entry isolation: a single user's Items fetch failing, or a single
    episode's series-identity lookup failing, skips just that user/episode
    rather than discarding plays already accumulated from the rest of the
    batch. Only the initial /Users fetch can fail the whole call.
    """
    try:
        u = await client.get("/Users")
        u.raise_for_status()
        users = u.json()
    except (httpx.HTTPError, ValueError):
        return []

    out, series_cache = [], {}
    for user in users:
        uid, uname = user.get("Id"), user.get("Name") or ""
        if not uid:
            continue
        try:
            r = await client.get(f"/Users/{uid}/Items", params=RECENT_PARAMS)
            r.raise_for_status()
            items = r.json().get("Items") or []
        except (httpx.HTTPError, ValueError):
            continue      # one user's fetch failing shouldn't drop everyone
        for item in items:
            played_at = _normalize_played_at(
                (item.get("UserData") or {}).get("LastPlayedDate") or "")
            if not played_at or played_at < since:
                continue
            if item.get("Type") == "Episode":
                sid = item.get("SeriesId")
                if not sid:
                    continue
                if sid not in series_cache:
                    try:
                        s = await client.get(
                            f"/Users/{uid}/Items",
                            params={"Ids": sid,
                                    "fields": "ProviderIds,ProductionYear"})
                        s.raise_for_status()
                        hits = s.json().get("Items") or []
                    except (httpx.HTTPError, ValueError):
                        continue  # bad series lookup — skip this episode, keep the batch
                    if not hits:
                        continue
                    series_cache[sid] = hits[0]
                show = series_cache[sid]
                out.append({"account": uname, "media_type": "tv",
                            "tmdb_id": _tmdb_from_provider_ids(show),
                            "title": show.get("Name") or "",
                            "year": show.get("ProductionYear"),
                            "played_at": played_at})
            elif item.get("Type") == "Movie":
                out.append({"account": uname, "media_type": "movie",
                            "tmdb_id": _tmdb_from_provider_ids(item),
                            "title": item.get("Name") or "",
                            "year": item.get("ProductionYear"),
                            "played_at": played_at})
    return out
