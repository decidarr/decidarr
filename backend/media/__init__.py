import config
from media import plex, jellyfin


def get_backend():
    name = config.resolve("media_server")
    return {"plex": plex, "jellyfin": jellyfin}.get(name or "")
