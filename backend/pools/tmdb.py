import httpx

import config


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url="https://api.themoviedb.org",
        params={"api_key": config.resolve("tmdb_api_key") or ""},
        timeout=15)


def _year(x: dict) -> int | None:
    date = x.get("release_date") or x.get("first_air_date") or ""
    return int(date[:4]) if date[:4].isdigit() else None


async def fetch(client, source_config, media_type):
    r = await client.get(f"/3/list/{source_config['list_id']}")
    r.raise_for_status()
    out, rank = [], 0
    for x in r.json().get("items", []):
        if x.get("media_type") != media_type:
            continue
        rank += 1
        out.append({"tmdb_id": x["id"],
                    "title": x.get("title") or x.get("name"),
                    "year": _year(x), "rank": rank})
    return out


async def details(client, tmdb_id, media_type):
    path = f"/3/{'tv' if media_type == 'tv' else 'movie'}/{tmdb_id}"
    try:
        r = await client.get(path)
        r.raise_for_status()
        d = r.json()
    except (httpx.HTTPError, ValueError):
        return {}
    if media_type == "tv":
        runtimes = d.get("episode_run_time") or []
        runtime = runtimes[0] if runtimes else None
        seasons = d.get("number_of_seasons")
    else:
        runtime, seasons = d.get("runtime"), None
    return {"runtime": runtime, "seasons": seasons,
            "genres": [g["name"] for g in d.get("genres", [])],
            "rating": d.get("vote_average"), "poster": d.get("poster_path")}


async def search(client, title, year, media_type):
    path = f"/3/search/{'tv' if media_type == 'tv' else 'movie'}"
    params = {"query": title}
    if year:
        params["year" if media_type == "movie" else "first_air_date_year"] = year
    try:
        r = await client.get(path, params=params)
        r.raise_for_status()
        results = r.json().get("results", [])
    except (httpx.HTTPError, ValueError):
        return None
    return results[0]["id"] if results else None
