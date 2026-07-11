import os
from contextlib import closing

import db

SETTING_ENV = {
    "tz": "TZ",
    "url_base": "URL_BASE",
    "seerr_url": "SEERR_URL", "seerr_api_key": "SEERR_API_KEY",
    "radarr_url": "RADARR_URL", "radarr_api_key": "RADARR_API_KEY",
    "sonarr_url": "SONARR_URL", "sonarr_api_key": "SONARR_API_KEY",
    "tv_request_seasons": "TV_REQUEST_SEASONS",
    "media_server": "MEDIA_SERVER",
    "plex_url": "PLEX_URL", "plex_token": "PLEX_TOKEN",
    "jellyfin_url": "JELLYFIN_URL", "jellyfin_api_key": "JELLYFIN_API_KEY",
    "tmdb_api_key": "TMDB_API_KEY",
    "trakt_client_id": "TRAKT_CLIENT_ID",
    "autolog_enabled": "AUTOLOG_ENABLED",
    "autolog_interval": "AUTOLOG_INTERVAL",
}


def is_env_set(key: str) -> bool:
    env = SETTING_ENV.get(key)
    return bool(env and os.environ.get(env))


def get_setting(key: str) -> str | None:
    with closing(db.get_conn()) as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?",
                           (key,)).fetchone()
    return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    with closing(db.get_conn()) as conn:
        conn.execute(
            "INSERT INTO settings(key,value) VALUES (?,?)"
            " ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
        conn.commit()


def resolve(key: str) -> str | None:
    if is_env_set(key):
        return os.environ[SETTING_ENV[key]]
    return get_setting(key)


def seed_settings() -> None:
    with closing(db.get_conn()) as conn:
        for key, env in SETTING_ENV.items():
            val = os.environ.get(env)
            if val:
                conn.execute(
                    "INSERT INTO settings(key,value) VALUES (?,?)"
                    " ON CONFLICT(key) DO NOTHING", (key, val))
        conn.commit()
