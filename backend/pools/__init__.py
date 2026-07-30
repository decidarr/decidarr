from pools import custom, plex, tmdb, trakt


def get_source(name: str):
    return {"custom": custom, "tmdb": tmdb, "trakt": trakt, "plex": plex}[name]
