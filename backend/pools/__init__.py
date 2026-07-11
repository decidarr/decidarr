from pools import custom, tmdb, trakt


def get_source(name: str):
    return {"custom": custom, "tmdb": tmdb, "trakt": trakt}[name]
