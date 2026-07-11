from datetime import datetime, timezone

import httpx

import config
from matching import best_match


def configured() -> bool:
    return bool(config.resolve("plex_url") and config.resolve("plex_token"))


def make_client() -> httpx.AsyncClient:
    url = config.resolve("plex_url")
    if not url:
        raise RuntimeError("Not configured — set a URL first")
    return httpx.AsyncClient(
        base_url=url.rstrip("/"),
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
    # rungs 2-3: title+year (reported as fuzzy). conf is deliberately
    # discarded here — rungs 2-3 always report "fuzzy" per spec, so we
    # don't branch on best_match's own exact/fuzzy/none distinction.
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


def _tmdb_from_guids(meta: dict) -> int | None:
    for g in meta.get("Guid") or []:
        gid = g.get("id") or ""
        if gid.startswith("tmdb://"):
            try:
                return int(gid[7:])
            except ValueError:
                return None
    return None


def _epoch_to_iso(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ")


def _iso_to_epoch(ts: str) -> int:
    return int(datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
               .replace(tzinfo=timezone.utc).timestamp())


async def recent_watches(client, since):
    """Completed plays since `since` (ISO UTC), normalized to
    {account, media_type, tmdb_id, title, year, played_at}. Episode plays
    carry the SHOW's identity. Plex writes a history entry exactly when it
    marks the item watched, so history IS the completion signal."""
    try:
        r = await client.get("/status/sessions/history/all")
        r.raise_for_status()
        entries = (r.json().get("MediaContainer") or {}).get("Metadata") or []
        since_epoch = _iso_to_epoch(since)
        fresh = [e for e in entries
                 if e.get("type") in ("movie", "episode")
                 and (e.get("viewedAt") or 0) >= since_epoch]
        if not fresh:
            return []
        acc = await client.get("/accounts")
        acc.raise_for_status()
        names = {a.get("id"): a.get("name") for a in
                 (acc.json().get("MediaContainer") or {}).get("Account") or []}
        out, meta_cache = [], {}
        for e in fresh:
            is_episode = e["type"] == "episode"
            key = str(e.get("grandparentRatingKey") if is_episode
                      else e.get("ratingKey") or "")
            if not key:
                continue
            if key not in meta_cache:
                m = await client.get(f"/library/metadata/{key}")
                m.raise_for_status()
                metas = (m.json().get("MediaContainer") or {}).get("Metadata") or []
                if not metas:
                    continue
                meta_cache[key] = metas[0]
            meta = meta_cache[key]
            out.append({
                "account": names.get(e.get("accountID")) or "",
                "media_type": "tv" if is_episode else "movie",
                "tmdb_id": _tmdb_from_guids(meta),
                "title": meta.get("title") or "",
                "year": meta.get("year"),
                "played_at": _epoch_to_iso(e.get("viewedAt") or 0),
            })
        return out
    except (httpx.HTTPError, ValueError):
        return []
