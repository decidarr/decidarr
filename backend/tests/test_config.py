import config

def test_resolve_env_wins_over_settings(db_file, monkeypatch):
    config.set_setting("seerr_url", "http://from-settings:5055")
    monkeypatch.setenv("SEERR_URL", "http://from-env:5055")
    assert config.resolve("seerr_url") == "http://from-env:5055"

def test_resolve_falls_back_to_settings(db_file, monkeypatch):
    monkeypatch.delenv("SEERR_URL", raising=False)
    config.set_setting("seerr_url", "http://from-settings:5055")
    assert config.resolve("seerr_url") == "http://from-settings:5055"

def test_resolve_missing_returns_none(db_file, monkeypatch):
    monkeypatch.delenv("RADARR_URL", raising=False)
    assert config.resolve("radarr_url") is None

def test_seed_settings_fills_missing_only(db_file, monkeypatch):
    monkeypatch.setenv("TMDB_API_KEY", "env-key")
    monkeypatch.setenv("SEERR_URL", "http://env:5055")
    config.set_setting("seerr_url", "http://existing:5055")
    config.seed_settings()
    assert config.get_setting("tmdb_api_key") == "env-key"     # seeded
    assert config.get_setting("seerr_url") == "http://existing:5055"  # kept

def test_non_credential_settings_resolve(db_file, monkeypatch):
    monkeypatch.delenv("TV_REQUEST_SEASONS", raising=False)
    assert config.resolve("tv_request_seasons") is None  # caller defaults 'first'
    config.set_setting("veto_tokens", "2")
    assert config.resolve("veto_tokens") == "2"
