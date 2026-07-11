import os
import pytest
from fastapi.testclient import TestClient

@pytest.fixture
def db_file(tmp_path, monkeypatch):
    path = str(tmp_path / "test.db")
    monkeypatch.setenv("DB_PATH", path)
    import db
    db.init_db(path)
    return path

@pytest.fixture
def client(db_file, monkeypatch):
    # env credentials would leak into config.resolve — strip them
    for var in ("SEERR_URL", "SEERR_API_KEY", "RADARR_URL", "RADARR_API_KEY",
                "SONARR_URL", "SONARR_API_KEY", "MEDIA_SERVER", "PLEX_URL",
                "PLEX_TOKEN", "JELLYFIN_URL", "JELLYFIN_API_KEY",
                "TMDB_API_KEY", "TRAKT_CLIENT_ID", "TV_REQUEST_SEASONS"):
        monkeypatch.delenv(var, raising=False)
    from app import app
    with TestClient(app) as c:
        yield c
