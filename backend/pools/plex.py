"""Pool source: the owner's own Plex library, section by section.

source_config: {"sections": ["1", "3"]} — Plex section keys as strings,
chosen in the UI from GET /api/plex/sections. Records match every other
source's shape ({tmdb_id, title, year, rank}) so refresh/enrichment work
unchanged and TMDB still supplies posters/runtime/genres. A failing section
is skipped (one bad section must not empty the pool); a failing top-level
sections call raises, which refresh_pool surfaces to the admin like any
other source error.
"""
import httpx

import db
from media.plex import make_client  # noqa: F401 — re-export for _client_for

_PLEX_TYPE = {"movie": "movie", "tv": "show"}


def _tmdb_from_guids(meta: dict) -> int | None:
    for g in meta.get("Guid") or []:
        gid = g.get("id") or ""
        if gid.startswith("tmdb://"):
            try:
                return int(gid[7:])
            except ValueError:
                return None
    return None


async def fetch(client, source_config, media_type):
    wanted = {str(k) for k in source_config.get("sections") or []}
    want_type = _PLEX_TYPE[media_type]

    r = await client.get("/library/sections")
    r.raise_for_status()
    sections = (r.json().get("MediaContainer") or {}).get("Directory") or []

    out, seen = [], set()
    for sec in sections:
        if str(sec.get("key")) not in wanted or sec.get("type") != want_type:
            continue
        try:
            resp = await client.get(
                f"/library/sections/{sec.get('key')}/all",
                params={"includeGuids": 1})
            resp.raise_for_status()
            metas = (resp.json().get("MediaContainer") or {}).get("Metadata") or []
        except (httpx.HTTPError, ValueError):
            continue
        for m in metas:
            title = m.get("title") or ""
            year = m.get("year")
            tmdb_id = _tmdb_from_guids(m)
            key = ("id", tmdb_id) if tmdb_id is not None \
                else ("t", db.normalize(title), year)
            if not title or key in seen:
                continue
            seen.add(key)
            out.append({"tmdb_id": tmdb_id, "title": title, "year": year,
                        "rank": len(out) + 1})
    return out
